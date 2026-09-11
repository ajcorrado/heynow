import { createClient } from "npm:@supabase/supabase-js@2";

type CanonicalVenue = {
  name: string | null;
  address: string | null;
  city: string | null;
  region: string | null;
  postalCode: string | null;
  latitude: number | null;
  longitude: number | null;
};

type CanonicalEvent = {
  sourceKey: string;
  sourceExternalId: string;
  sourceUrl: string;
  title: string;
  description: string | null;
  category: string | null;
  tags: string[];
  startAt: string;
  endAt: string | null;
  timezone: string;
  isAllDay: boolean;
  venue: CanonicalVenue;
  imageUrl: string | null;
  eventUrl: string;
  officialUrl: string | null;
  ticketUrl: string | null;
  admissionText: string | null;
  isFree: boolean | null;
  ingestedAt: string;
  rawText: string;
  rawPayload: Record<string, unknown>;
  extractionConfidence: number;
};

type SourceDiscovery = { url: string; externalIdHint?: string; occurrenceDate?: string };
type SourceAdapter = { key: string; name: string; discover(): Promise<SourceDiscovery[]>; fetchAndNormalize(item: SourceDiscovery): Promise<CanonicalEvent | null> };
type SupabaseLike = any;

function partsFor(date: Date, timeZone: string) {
  const formatter = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
  const parts = Object.fromEntries(formatter.formatToParts(date).filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  return { year: Number(parts.year), month: Number(parts.month), day: Number(parts.day), hour: Number(parts.hour), minute: Number(parts.minute), second: Number(parts.second) };
}
function offsetMs(date: Date, timeZone: string) { const p = partsFor(date, timeZone); return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - date.getTime(); }
function localDateTimeToUtc(value: string, timeZone: string): string {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2}))?)?$/);
  if (!match) throw new Error(`Unsupported local datetime: ${value}`);
  const [, y, mo, d, h = "00", mi = "00", s = "00"] = match;
  const guessMs = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s));
  const guess = new Date(guessMs);
  let offset = offsetMs(guess, timeZone);
  let result = new Date(guessMs - offset);
  const correctedOffset = offsetMs(result, timeZone);
  if (correctedOffset !== offset) result = new Date(guessMs - correctedOffset);
  return result.toISOString();
}
function isDateOnly(value: string | undefined | null) { return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value)); }
function normalizeText(value: string) { return value.normalize("NFKD").toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim(); }
function slugify(value: string) { return normalizeText(value).replace(/\s+/g, "-").replace(/^-|-$/g, "") || "event"; }
function obviousDuplicate(incoming: { title: string; startAt: string; venueName: string | null }, candidates: Array<{ id: string; title: string; startAt: string; venueName: string | null }>) {
  const title = normalizeText(incoming.title); const incomingTime = new Date(incoming.startAt).getTime();
  return candidates.find((candidate) => normalizeText(candidate.title) === title && Math.abs(new Date(candidate.startAt).getTime() - incomingTime) <= 2 * 60 * 60 * 1000 && (!(incoming.venueName && candidate.venueName) || normalizeText(incoming.venueName) === normalizeText(candidate.venueName))) ?? null;
}

const VISIT_EL_PASO_SOURCE_KEY = "visit-el-paso";
const VISIT_EL_PASO_BASE = "https://visitelpaso.com";
const VISIT_EL_PASO_INDEX = `${VISIT_EL_PASO_BASE}/events/`;
const VISIT_EL_PASO_TIMEZONE = "America/Denver";
const NON_DETAIL_SLUGS = new Set(["annual-events-and-festivals", "free", "weekend", "regional-events", "live-music-small-venue"]);
function decodeHtml(value: string) { return value.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " "); }
function stripTags(value: string) { return decodeHtml(value.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()); }
function extractJsonLd(html: string): unknown[] { const values: unknown[] = []; const regex = /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi; for (const match of html.matchAll(regex)) { try { values.push(JSON.parse(match[1].trim())); } catch {} } return values; }
function isEventType(value: unknown) { return value === "Event" || (Array.isArray(value) && value.includes("Event")); }
function findEventNode(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") return null;
  if (Array.isArray(value)) { for (const item of value) { const found = findEventNode(item); if (found) return found; } return null; }
  const object = value as Record<string, unknown>; if (isEventType(object["@type"])) return object; const graph = object["@graph"]; if (Array.isArray(graph)) return findEventNode(graph); return null;
}
function stringOrNull(value: unknown) { return typeof value === "string" && value.trim() ? value.trim() : null; }

function normalizeRegion(value: string | null) {
  if (!value) return null;
  const normalized = value.trim().replace(/\.$/, "");
  if (/^(tx|texas)$/i.test(normalized)) return "TX";
  if (/^(nm|n\.?m\.?|new mexico)$/i.test(normalized)) return "NM";
  return normalized;
}
function parseUnstructuredAddress(address: string) {
  const raw = address.replace(/\s+/g, " ").trim();
  const zipMatches = [...raw.matchAll(/\b(\d{5})(?:-\d{4})?\b/g)];
  let postalCode = zipMatches.length ? zipMatches[zipMatches.length - 1][1] : null;
  let city: string | null = null;
  let region: string | null = null;

  const usGeneral = raw.match(/,\s*([^,]+),\s*([A-Za-z. ]+?)(?:,\s*|\s+)(\d{5})(?:-\d{4})?(?:,\s*(?:USA|United States))?\s*$/i);
  const usShort = raw.match(/,\s*([^,]+),\s*(TX|Tx\.?|Texas|NM|N\.?M\.?|New Mexico)\s*(?:\d{5}(?:-\d{4})?)?\s*$/i);
  if (usGeneral) {
    city = usGeneral[1].trim();
    region = normalizeRegion(usGeneral[2].trim());
    postalCode = usGeneral[3];
  } else if (usShort) {
    city = usShort[1].trim();
    region = normalizeRegion(usShort[2]);
  } else if (/\bSocorro\b/i.test(raw)) {
    city = "Socorro"; region = "TX";
  } else if (/\bSan Elizario\b/i.test(raw)) {
    city = "San Elizario"; region = "TX";
  } else if (/\bEl Paso\b/i.test(raw)) {
    city = "El Paso"; region = "TX";
  } else if (/\bLas Cruces\b/i.test(raw)) {
    city = "Las Cruces"; region = "NM";
  } else if (/\bAlpine\b/i.test(raw)) {
    city = "Alpine"; region = "TX";
  } else {
    const foreign = raw.match(/,\s*([^,]+),\s*(Japan|Mexico|Canada)\s*$/i);
    if (foreign) {
      city = foreign[1].trim();
      region = foreign[2];
    } else {
      const country = raw.match(/,\s*(Japan|Mexico|Canada|United States|USA)\s*$/i)?.[1] ?? null;
      if (country) region = country;
    }
  }
  return { rawAddress: raw || null, city, region, postalCode };
}
function parseLocation(node: Record<string, unknown>) {
  const location = node.location && typeof node.location === "object" ? node.location as Record<string, unknown> : {};
  const address = location.address;
  let rawAddress: string | null = null;
  let city: string | null = null;
  let region: string | null = null;
  let postalCode: string | null = null;
  if (typeof address === "string") {
    const parsed = parseUnstructuredAddress(address);
    rawAddress = parsed.rawAddress; city = parsed.city; region = parsed.region; postalCode = parsed.postalCode;
  } else if (address && typeof address === "object") {
    const a = address as Record<string, unknown>;
    rawAddress = [a.streetAddress, a.addressLocality, a.addressRegion, a.postalCode].filter((v) => typeof v === "string" && v.trim()).join(", ") || null;
    city = stringOrNull(a.addressLocality);
    region = normalizeRegion(stringOrNull(a.addressRegion));
    postalCode = stringOrNull(a.postalCode);
  }
  const geo = location.geo && typeof location.geo === "object" ? location.geo as Record<string, unknown> : {};
  const lat = Number(geo.latitude); const lon = Number(geo.longitude);
  return { name: stringOrNull(location.name)?.replace(/\s+/g, " ").trim() ?? null, address: rawAddress, city, region, postalCode, latitude: Number.isFinite(lat) ? lat : null, longitude: Number.isFinite(lon) ? lon : null };
}

function extractAdmission(html: string) { const match = html.match(/<span>\s*Admission:\s*<\/span>\s*([^<\n]+)/i); return match ? stripTags(match[1]) : null; }
function extractActionLinks(html: string) { let officialUrl: string | null = null; let ticketUrl: string | null = null; const regex = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi; for (const match of html.matchAll(regex)) { const href = decodeHtml(match[1]); const text = stripTags(match[2]).toLowerCase(); if (!/^https?:\/\//i.test(href) || href.includes("visitelpaso.com")) continue; if (!ticketUrl && /(buy\s*tickets?|tickets?|register|registration|rsvp)/i.test(text)) ticketUrl = href; if (!officialUrl && /(view\s*website|website|event\s*website)/i.test(text)) officialUrl = href; } return { officialUrl, ticketUrl }; }
function extractFullDescription(html: string) { const match = html.match(/<div class=["']col-lg-12["']>\s*<div class=["']mb-5["']>([\s\S]*?)<\/div>\s*<\/div>\s*<div class=["']col-12["']>/i); if (!match) return null; const paragraphs = [...match[1].matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)].map((x) => stripTags(x[1])).filter(Boolean).filter((text) => !/^(view website|contact name:|contact e-mail address:|contact phone number:)/i.test(text)); return paragraphs.length ? paragraphs.join("\n\n") : null; }
function imageUrl(node: Record<string, unknown>) { const image = node.image; if (typeof image === "string") return image; if (Array.isArray(image)) return image.find((item) => typeof item === "string") as string | undefined ?? null; if (image && typeof image === "object") return stringOrNull((image as Record<string, unknown>).url); return null; }
function discoverVisitElPasoEvents(indexHtml: string): SourceDiscovery[] { const found = new Set<string>(); const regex = /href=["']([^"']+)["']/gi; for (const match of indexHtml.matchAll(regex)) { let href = decodeHtml(match[1]); if (href.startsWith(VISIT_EL_PASO_BASE)) href = href.slice(VISIT_EL_PASO_BASE.length); const path = href.split(/[?#]/, 1)[0]; const pm = path.match(/^\/events\/([^/]+)$/); if (!pm || NON_DETAIL_SLUGS.has(pm[1])) continue; found.add(`${VISIT_EL_PASO_BASE}${path}`); } return [...found].sort().map((url) => ({ url, externalIdHint: `${url}#event` })); }
function parseVisitElPasoEvent(html: string, sourceUrl: string, ingestedAt = new Date().toISOString()): CanonicalEvent | null {
  const node = extractJsonLd(html).map(findEventNode).find(Boolean) as Record<string, unknown> | undefined; if (!node) return null;
  const title = stringOrNull(node.name); const sourceStart = stringOrNull(node.startDate); if (!title || !sourceStart) return null;
  const sourceEnd = stringOrNull(node.endDate); const isAllDay = isDateOnly(sourceStart); const startAt = localDateTimeToUtc(sourceStart, VISIT_EL_PASO_TIMEZONE); let endAt: string | null = null;
  if (sourceEnd) { if (!isAllDay && isDateOnly(sourceEnd) && sourceEnd === sourceStart.slice(0, 10)) endAt = null; else endAt = localDateTimeToUtc(sourceEnd, VISIT_EL_PASO_TIMEZONE); }
  const venue = parseLocation(node); const admissionText = extractAdmission(html); const actions = extractActionLinks(html); const fullDescription = extractFullDescription(html); const eventUrl = stringOrNull(node.url) ?? sourceUrl; const externalId = stringOrNull(node["@id"]) ?? `${eventUrl}#event`;
  return { sourceKey: VISIT_EL_PASO_SOURCE_KEY, sourceExternalId: externalId, sourceUrl, title, description: fullDescription ?? stringOrNull(node.description), category: null, tags: [], startAt, endAt, timezone: VISIT_EL_PASO_TIMEZONE, isAllDay, venue, imageUrl: imageUrl(node), eventUrl, officialUrl: actions.officialUrl, ticketUrl: actions.ticketUrl, admissionText, isFree: admissionText ? /\bfree\b/i.test(admissionText) : null, ingestedAt, rawText: html, rawPayload: { jsonLdEvent: node, admissionText, officialUrl: actions.officialUrl, ticketUrl: actions.ticketUrl }, extractionConfidence: 0.97 };
}
const visitElPasoAdapter: SourceAdapter = { key: VISIT_EL_PASO_SOURCE_KEY, name: "Visit El Paso", async discover() { const res = await fetch(VISIT_EL_PASO_INDEX, { headers: { "user-agent": "HeyNow/0.1 (+event-ingestion)" } }); if (!res.ok) throw new Error(`Visit El Paso discovery failed: ${res.status}`); return discoverVisitElPasoEvents(await res.text()); }, async fetchAndNormalize(item) { const res = await fetch(item.url, { headers: { "user-agent": "HeyNow/0.1 (+event-ingestion)" } }); if (!res.ok) throw new Error(`Visit El Paso event fetch failed ${res.status}: ${item.url}`); return parseVisitElPasoEvent(await res.text(), item.url); } };

type GenericAdapterConfig = {
  key: string;
  name: string;
  index: string;
  timezone?: string;
  defaultVenue?: CanonicalVenue;
  linkPattern: RegExp;
};
const genericHeaders = { "user-agent": "HeyNow/0.1 (+event-ingestion)", accept: "text/html,application/xhtml+xml" };
function absoluteUrl(value: string, base: string) {
  try { return new URL(value, base).toString(); } catch { return null; }
}
function discoverGenericEvents(html: string, base: string, config: GenericAdapterConfig): SourceDiscovery[] {
  const found = new Set<string>();
  for (const match of html.matchAll(/href=["']([^"']+)["']/gi)) {
    const url = absoluteUrl(decodeHtml(match[1]), base);
    if (!url || !config.linkPattern.test(url)) continue;
    found.add(url.split(/[?#]/, 1)[0]);
  }
  for (const value of extractJsonLd(html)) {
    const nodes: Record<string, unknown>[] = [];
    const visit = (candidate: unknown) => {
      if (!candidate || typeof candidate !== "object") return;
      if (Array.isArray(candidate)) { candidate.forEach(visit); return; }
      const object = candidate as Record<string, unknown>;
      if (isEventType(object["@type"]) && stringOrNull(object.url)) nodes.push(object);
      if (object["@graph"]) visit(object["@graph"]);
      if (object.item) visit(object.item);
    };
    visit(value);
    for (const node of nodes) { const url = absoluteUrl(String(node.url), base); if (url) found.add(url.split(/[?#]/, 1)[0]); }
  }
  return [...found].map((url) => ({ url, externalIdHint: `${url}#event` }));
}
function genericDate(value: string, timezone: string) {
  if (/\d[T ]\d.*(?:Z|[+-]\d{2}:?\d{2})$/i.test(value)) return new Date(value).toISOString();
  return localDateTimeToUtc(value.replace(/\s+/, "T").replace(/T(\d{1,2}):(\d{2})\s*([AP]M)$/i, (_, h, m, ap) => `T${time24(`${h}:${m} ${ap}`)}`), timezone);
}
function genericOfferText(node: Record<string, unknown>) {
  const offers = node.offers && typeof node.offers === "object" ? node.offers as Record<string, unknown> : {};
  const price = stringOrNull(offers.price) ?? (typeof offers.lowPrice === "number" ? String(offers.lowPrice) : null);
  const currency = stringOrNull(offers.priceCurrency);
  return price ? `${currency ? currency + " " : ""}${price}` : null;
}
function parseGenericEvent(html: string, sourceUrl: string, config: GenericAdapterConfig): CanonicalEvent | null {
  const node = extractJsonLd(html).map(findEventNode).find(Boolean) as Record<string, unknown> | undefined;
  const title = stringOrNull(node?.name) ?? metaContent(html, "og:title");
  const sourceStart = stringOrNull(node?.startDate);
  if (!title || !sourceStart) return null;
  const timezone = config.timezone ?? "America/Denver";
  let startAt: string; try { startAt = genericDate(sourceStart, timezone); } catch { return null; }
  const sourceEnd = stringOrNull(node?.endDate); let endAt: string | null = null;
  if (sourceEnd) { try { endAt = genericDate(sourceEnd, timezone); } catch {} }
  const venue = node ? parseLocation(node) : config.defaultVenue ?? { name: null, address: null, city: null, region: null, postalCode: null, latitude: null, longitude: null };
  const resolvedVenue = venue.name ? venue : config.defaultVenue ?? venue;
  const price = node ? genericOfferText(node) : null;
  const description = stringOrNull(node?.description) ?? metaContent(html, "og:description");
  const eventUrl = stringOrNull(node?.url) ?? sourceUrl;
  const image = node ? imageUrl(node) : metaContent(html, "og:image");
  return { sourceKey: config.key, sourceExternalId: stringOrNull(node?.["@id"]) ?? `${eventUrl}#event`, sourceUrl, title, description, category: null, tags: [], startAt, endAt, timezone, isAllDay: isDateOnly(sourceStart), venue: resolvedVenue, imageUrl: image, eventUrl, officialUrl: eventUrl, ticketUrl: null, admissionText: price, isFree: price ? /^(?:free|0(?:\.00)?)$/i.test(price.replace(/^[A-Z]{3}\s*/i, "")) : (description ? /\bfree\b/i.test(description) : null), ingestedAt: new Date().toISOString(), rawText: html, rawPayload: { jsonLdEvent: node ?? null }, extractionConfidence: node ? 0.9 : 0.55 };
}
function genericAdapter(config: GenericAdapterConfig): SourceAdapter {
  return { key: config.key, name: config.name, async discover() { const res = await fetch(config.index, { headers: genericHeaders }); if (!res.ok) throw new Error(`${config.name} discovery failed: ${res.status}`); return discoverGenericEvents(await res.text(), config.index, config); }, async fetchAndNormalize(item) { const res = await fetch(item.url, { headers: genericHeaders }); if (!res.ok) throw new Error(`${config.name} event fetch failed ${res.status}: ${item.url}`); return parseGenericEvent(await res.text(), item.url, config); } };
}
const elPasoLiveAdapter = genericAdapter({ key: "el-paso-live", name: "El Paso Live", index: "https://www.elpasolive.com/events", linkPattern: /elpasolive\.com\/events\//i });
const lowbrowAdapter = genericAdapter({ key: "lowbrow-palace", name: "Lowbrow Palace", index: "https://lowbrowpalace.com/calendar/", linkPattern: /lowbrowpalace\.com\/(?:event|calendar)\//i, defaultVenue: { name: "Lowbrow Palace", address: "111 E Robinson Ave, El Paso, TX 79902", city: "El Paso", region: "TX", postalCode: "79902", latitude: null, longitude: null } });
const falstaffAdapter = genericAdapter({ key: "the-falstaff", name: "The Falstaff", index: "https://www.thefalstaffproject.com/events-1", linkPattern: /thefalstaffproject\.com\/events?[-/]/i, defaultVenue: { name: "The Falstaff", address: "3801 Frutas Avenue, Ste. E, El Paso, TX 79905", city: "El Paso", region: "TX", postalCode: "79905", latitude: null, longitude: null } });
const loveBuzzAdapter = genericAdapter({ key: "love-buzz", name: "Love Buzz", index: "https://songkick.com/venues/3236249-love-buzz", linkPattern: /songkick\.com\/concerts\//i, defaultVenue: { name: "Love Buzz", address: "3011 Pershing Drive, El Paso, TX 79903", city: "El Paso", region: "TX", postalCode: "79903", latitude: null, longitude: null } });
const versoAdapter = genericAdapter({ key: "verso", name: "VERSO", index: "https://www.versoelpaso.com/", linkPattern: /versoelpaso\.com\/event-details\//i, defaultVenue: { name: "VERSO", address: "2711 N Stanton St, El Paso, TX 79902", city: "El Paso", region: "TX", postalCode: "79902", latitude: null, longitude: null } });


const KTEP_SOURCE_KEY = "ktep";
const KTEP_INDEX = "https://www.ktep.org/community-calendar";
const KTEP_TIMEZONE = "America/Denver";
const KTEP_HORIZON_DAYS = 120;
const KTEP_MAX_PAGES = 70;
const ktepDetailCache = new Map<string, Promise<string>>();

function escapeRegex(value: string) {
  const special = new Set(["\\","^","$",".","|","?","*","+","(",")","[","]","{","}"]);
  return [...value].map((char) => special.has(char) ? "\\" + char : char).join("");
}
function extractClassInner(html: string, className: string) {
  const markers = ['class="' + className + '"', "class='" + className + "'"];
  let markerIndex = -1;
  for (const marker of markers) {
    markerIndex = html.indexOf(marker);
    if (markerIndex >= 0) break;
  }
  if (markerIndex < 0) return null;
  const openStart = html.lastIndexOf("<", markerIndex);
  const openEnd = html.indexOf(">", markerIndex);
  if (openStart < 0 || openEnd < 0) return null;
  const tag = html.slice(openStart + 1, openEnd).match(/^([a-z0-9-]+)/i)?.[1];
  if (!tag) return null;
  const close = "</" + tag + ">";
  const closeIndex = html.indexOf(close, openEnd + 1);
  if (closeIndex < 0) return null;
  return html.slice(openEnd + 1, closeIndex);
}
function blockText(value: string | null) {
  if (!value) return null;
  const text = decodeHtml(value.replace(/<br\s*\/?>/gi, "\n").replace(/<\/(?:p|div|li)>/gi, "\n").replace(/<[^>]+>/g, " ").replace(/[ \t]+/g, " ").replace(/\n\s+/g, "\n").replace(/\n{3,}/g, "\n\n").trim());
  return text || null;
}
function metaContent(html: string, property: string) {
  const markers = ['property="' + property + '"', "property='" + property + "'", 'name="' + property + '"', "name='" + property + "'"];
  for (const marker of markers) {
    const index = html.indexOf(marker);
    if (index < 0) continue;
    const start = html.lastIndexOf("<meta", index);
    const end = html.indexOf(">", index);
    if (start < 0 || end < 0) continue;
    const tag = html.slice(start, end + 1);
    const match = tag.match(/content=["']([^"']*)["']/i);
    if (match) return decodeHtml(match[1].trim()) || null;
  }
  return null;
}
function ktepMonth(month: string) {
  const months: Record<string, number> = { jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,sept:9,oct:10,nov:11,dec:12 };
  return months[month.toLowerCase()] ?? null;
}
function denverTodayParts() {
  const p = partsFor(new Date(), KTEP_TIMEZONE);
  return { year:p.year, month:p.month, day:p.day };
}
function ktepOccurrenceDate(label: string) {
  const match = label.match(/\b([A-Za-z]{3,4})\s+(\d{1,2})\b/);
  if (!match) return null;
  const month = ktepMonth(match[1]); if (!month) return null;
  const day = Number(match[2]);
  const today = denverTodayParts();
  let year = today.year;
  const candidate = Date.UTC(year, month - 1, day);
  const todayUtc = Date.UTC(today.year, today.month - 1, today.day);
  if (candidate < todayUtc - 14 * 86400000) year += 1;
  return year.toString().padStart(4,"0") + "-" + month.toString().padStart(2,"0") + "-" + day.toString().padStart(2,"0");
}
function ktepPromoDiscoveries(html: string) {
  const out: SourceDiscovery[] = [];
  const chunks = html.split(/<ps-promo class=["']PromoEvent["'][^>]*>/i).slice(1);
  for (const part of chunks) {
    const chunk = part.split(/<\/ps-promo>/i)[0] ?? "";
    const url = decodeHtml(chunk.match(/data-href=["']([^"']+community-calendar\/event\/[^"']+)["']/i)?.[1] ?? chunk.match(/href=["']([^"']+community-calendar\/event\/[^"']+)["']/i)?.[1] ?? "");
    const dateHtml = chunk.match(/PromoEvent-date-date["'][^>]*>([\s\S]*?)<\/p>/i)?.[1] ?? "";
    const occurrenceDate = ktepOccurrenceDate(stripTags(dateHtml));
    if (!url || !occurrenceDate) continue;
    out.push({ url, occurrenceDate, externalIdHint: url + "#" + occurrenceDate });
  }
  return out;
}
function ktepPageCount(html: string) {
  const match = html.match(/EventSearchResultsModule-pageCounts[^>]*>\s*(\d+)\s+of\s+(\d+)/i);
  return match ? Number(match[2]) : 1;
}
function isoDatePlusDays(date: string, days: number) {
  const d = new Date(date + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0,10);
}
function time24(value: string) {
  const match = value.trim().match(/^(\d{1,2}):(\d{2})\s*([AP]M)$/i); if (!match) return null;
  let hour = Number(match[1]); const minute = Number(match[2]); const ap = match[3].toUpperCase();
  if (hour === 12) hour = 0; if (ap === "PM") hour += 12;
  return hour.toString().padStart(2,"0") + ":" + minute.toString().padStart(2,"0") + ":00";
}
function occurrenceWeekday(date: string) {
  return new Intl.DateTimeFormat("en-US", { weekday:"long", timeZone:"UTC" }).format(new Date(date + "T12:00:00Z"));
}
function parseKtepOccurrenceTime(timeText: string | null, occurrenceDate: string) {
  if (!timeText) return { startAt: localDateTimeToUtc(occurrenceDate, KTEP_TIMEZONE), endAt:null, isAllDay:true };
  const weekday = occurrenceWeekday(occurrenceDate);
  const dayMatch = timeText.match(new RegExp(escapeRegex(weekday) + "\\s*:\\s*(\\d{1,2}:\\d{2}\\s*[AP]M)\\s*-\\s*(\\d{1,2}:\\d{2}\\s*[AP]M)", "i"));
  const generic = timeText.match(/(\d{1,2}:\d{2}\s*[AP]M)\s*-\s*(\d{1,2}:\d{2}\s*[AP]M)/i);
  const range = dayMatch ?? generic;
  if (!range) return { startAt: localDateTimeToUtc(occurrenceDate, KTEP_TIMEZONE), endAt:null, isAllDay:true };
  const start = time24(range[1]); const end = time24(range[2]);
  if (!start || !end) return { startAt: localDateTimeToUtc(occurrenceDate, KTEP_TIMEZONE), endAt:null, isAllDay:true };
  const startAt = localDateTimeToUtc(occurrenceDate + "T" + start, KTEP_TIMEZONE);
  let endDate = occurrenceDate; let endAt = localDateTimeToUtc(endDate + "T" + end, KTEP_TIMEZONE);
  if (new Date(endAt).getTime() <= new Date(startAt).getTime()) { endDate = isoDatePlusDays(occurrenceDate, 1); endAt = localDateTimeToUtc(endDate + "T" + end, KTEP_TIMEZONE); }
  return { startAt, endAt, isAllDay:false };
}
function ktepCategories(html: string) {
  const outer = extractClassInner(html, "EventPage-categories") ?? "";
  return [...outer.matchAll(/<a[^>]*>([\s\S]*?)<\/a>/gi)].map((m) => stripTags(m[1])).filter(Boolean);
}
function ktepVenue(html: string): CanonicalVenue {
  const name = blockText(extractClassInner(html, "VenueInformation-name")) ?? blockText(extractClassInner(html, "EventPage-information-venueName"));
  const street = blockText(extractClassInner(html, "VenueInformation-address-streetAddress"));
  const city = blockText(extractClassInner(html, "VenueInformation-address-city"));
  const region = normalizeRegion(blockText(extractClassInner(html, "VenueInformation-address-state")));
  const postalCode = blockText(extractClassInner(html, "VenueInformation-address-zip"));
  const address = [street, city, region, postalCode].filter(Boolean).join(", ") || null;
  return { name, address, city, region, postalCode, latitude:null, longitude:null };
}
function normalizeExternalUrl(value: string | null) {
  if (!value) return null;
  const clean = decodeHtml(value.trim());
  if (/^https?:\/\//i.test(clean)) return clean;
  if (/^\/\//.test(clean)) return "https:" + clean;
  if (/^(?:www\.)?[a-z0-9.-]+\.[a-z]{2,}(?:\/|$)/i.test(clean)) return "https://" + clean.replace(/^\/+/, "");
  return null;
}
function ktepPrice(html: string) { return blockText(extractClassInner(html, "EventPage-information-price")); }
function ktepTicketUrl(html: string) {
  const outer = html.match(/<div[^>]*class=["'][^"']*\bEventPage-ticketing\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i)?.[1] ?? "";
  return normalizeExternalUrl(outer.match(/href=["']([^"']+)["']/i)?.[1] ?? null);
}
function ktepOfficialUrl(html: string) {
  const outer = html.match(/<div[^>]*class=["'][^"']*\bPresentingOrganizationInformation-website\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i)?.[1] ?? "";
  const match = outer.match(/href=(?:["']([^"']+)["']|([^\s>]+))/i);
  return normalizeExternalUrl(match?.[1] ?? match?.[2] ?? null);
}
async function fetchKtepDetail(url: string) {
  let promise = ktepDetailCache.get(url);
  if (!promise) {
    promise = fetch(url, { headers: { "user-agent":"HeyNow/0.1 (+event-ingestion)" } }).then(async (res) => {
      if (!res.ok) throw new Error("KTEP event fetch failed " + res.status + ": " + url);
      return await res.text();
    });
    ktepDetailCache.set(url, promise);
  }
  return await promise;
}
const ktepAdapter: SourceAdapter = {
  key: KTEP_SOURCE_KEY,
  name: "KTEP Community Calendar",
  async discover() {
    const firstRes = await fetch(KTEP_INDEX, { headers: { "user-agent":"HeyNow/0.1 (+event-ingestion)" } });
    if (!firstRes.ok) throw new Error("KTEP discovery failed: " + firstRes.status);
    const firstHtml = await firstRes.text();
    const totalPages = Math.min(ktepPageCount(firstHtml), KTEP_MAX_PAGES);
    const p=denverTodayParts();
    const today=p.year.toString().padStart(4,"0")+"-"+p.month.toString().padStart(2,"0")+"-"+p.day.toString().padStart(2,"0");
    const horizon = isoDatePlusDays(today, KTEP_HORIZON_DAYS);
    const discovered = new Map<string, SourceDiscovery>();
    let beyondHorizonPages = 0;
    for (let page = 1; page <= totalPages; page++) {
      let html = firstHtml;
      if (page > 1) {
        const res = await fetch(KTEP_INDEX + "?p=" + page, { headers: { "user-agent":"HeyNow/0.1 (+event-ingestion)" } });
        if (!res.ok) throw new Error("KTEP discovery page failed " + res.status + ": " + page);
        html = await res.text();
      }
      const items = ktepPromoDiscoveries(html);
      let pageHasInRange = false;
      let allBeyond = items.length > 0;
      for (const item of items) {
        if (!item.occurrenceDate) continue;
        if (item.occurrenceDate >= today && item.occurrenceDate <= horizon) {
          discovered.set(item.externalIdHint ?? (item.url + "#" + item.occurrenceDate), item);
          pageHasInRange = true;
        }
        if (item.occurrenceDate <= horizon) allBeyond = false;
      }
      if (!pageHasInRange && allBeyond) beyondHorizonPages += 1; else beyondHorizonPages = 0;
      if (beyondHorizonPages >= 2) break;
    }
    return [...discovered.values()];
  },
  async fetchAndNormalize(item) {
    if (!item.occurrenceDate) return null;
    const html = await fetchKtepDetail(item.url);
    const title = blockText(extractClassInner(html, "EventPage-name")) ?? metaContent(html, "og:title");
    if (!title) return null;
    const description = blockText(extractClassInner(html, "EventPage-description")) ?? metaContent(html, "og:description");
    const timeText = blockText(extractClassInner(html, "EventPage-information-time"));
    const timing = parseKtepOccurrenceTime(timeText, item.occurrenceDate);
    const categories = ktepCategories(html);
    const venue = ktepVenue(html);
    const price = ktepPrice(html);
    const contentId = html.match(/<meta[^>]+name=["']brightspot\.contentId["'][^>]+content=["']([^"']+)["']/i)?.[1] ?? item.url;
    const officialUrl = ktepOfficialUrl(html);
    const ticketUrl = ktepTicketUrl(html);
    const image = normalizeExternalUrl(metaContent(html, "og:image"));
    const isFree = price ? (/^\s*(?:\$?0(?:\.00)?|free)\s*$/i.test(price) ? true : false) : (description && /\bfree\b/i.test(description) ? true : null);
    return {
      sourceKey: KTEP_SOURCE_KEY, sourceExternalId: contentId + "#" + item.occurrenceDate, sourceUrl: item.url,
      title, description, category: categories[0] ?? null, tags: categories,
      startAt: timing.startAt, endAt: timing.endAt, timezone: KTEP_TIMEZONE, isAllDay: timing.isAllDay,
      venue, imageUrl: image, eventUrl: item.url, officialUrl, ticketUrl, admissionText: price, isFree,
      ingestedAt: new Date().toISOString(), rawText: html,
      rawPayload: { occurrenceDate:item.occurrenceDate, categories, timeText, price, brightspotContentId:contentId },
      extractionConfidence: 0.95
    };
  }
};

async function sha256(value: string) { const data = new TextEncoder().encode(value); const digest = await crypto.subtle.digest("SHA-256", data); return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join(""); }

function sameOptionalText(incoming: string | null, stored: string | null) {
  return incoming == null || normalizeText(incoming) === normalizeText(stored ?? "");
}
function sameOptionalNumber(incoming: number | null, stored: number | null) {
  return incoming == null || stored != null && Math.abs(incoming - stored) < 0.000001;
}
function venueSnapshot(venue: any, venueId: string | null) {
  return {
    venue_id: venueId,
    name: venue?.name ?? null,
    address_line_1: venue?.address_line_1 ?? null,
    locality: venue?.locality ?? null,
    region: venue?.region ?? null,
    postal_code: venue?.postal_code ?? null,
    latitude: venue?.latitude ?? null,
    longitude: venue?.longitude ?? null
  };
}
async function venueIsProtected(supabase: SupabaseLike, venueId: string) {
  const { data, error } = await supabase.from("events").select("id,event_editorial!inner(data_review_state)").eq("venue_id", venueId).eq("event_editorial.data_review_state", "approved").limit(1);
  if (error) throw error;
  return Boolean(data?.length);
}
async function resolveVenue(supabase: SupabaseLike, marketCityId: string, event: CanonicalEvent, options: { allowUpdates?: boolean; fallbackVenue?: any } = {}) {
  if (!event.venue.name) return null;
  const allowUpdates = options.allowUpdates !== false;
  const cleanName = event.venue.name.replace(/\s+/g, " ").trim();
  const normalized = normalizeText(cleanName);
  const desired = {
    name: cleanName,
    address_line_1: event.venue.address ?? options.fallbackVenue?.address_line_1 ?? null,
    locality: event.venue.city ?? options.fallbackVenue?.locality ?? null,
    region: event.venue.region ?? options.fallbackVenue?.region ?? null,
    postal_code: event.venue.postalCode ?? options.fallbackVenue?.postal_code ?? null,
    latitude: event.venue.latitude ?? options.fallbackVenue?.latitude ?? null,
    longitude: event.venue.longitude ?? options.fallbackVenue?.longitude ?? null
  };
  const { data, error } = await supabase.from("venues").select("id,address_line_1,locality,region,postal_code,name,latitude,longitude").eq("city_id", marketCityId).eq("normalized_name", normalized).limit(20);
  if (error) throw error;
  const match = (data ?? []).find((row: any) => {
    if (!allowUpdates) return sameOptionalText(desired.address_line_1, row.address_line_1) && sameOptionalText(desired.locality, row.locality) && sameOptionalText(desired.region, row.region) && sameOptionalText(desired.postal_code, row.postal_code) && sameOptionalNumber(desired.latitude, row.latitude) && sameOptionalNumber(desired.longitude, row.longitude);
    if (event.venue.address && row.address_line_1 && normalizeText(event.venue.address) === normalizeText(row.address_line_1)) return true;
    if (event.venue.city && row.locality && normalizeText(event.venue.city) === normalizeText(row.locality)) return true;
    return !event.venue.address && !row.address_line_1;
  });
  if (match) {
    if (!allowUpdates || await venueIsProtected(supabase, match.id)) {
      if (sameOptionalText(desired.address_line_1, match.address_line_1) && sameOptionalText(desired.locality, match.locality) && sameOptionalText(desired.region, match.region) && sameOptionalText(desired.postal_code, match.postal_code) && sameOptionalNumber(desired.latitude, match.latitude) && sameOptionalNumber(desired.longitude, match.longitude)) return match.id;
      const { data: staged, error: stagedError } = await supabase.from("venues").insert({ city_id: marketCityId, name: desired.name, normalized_name: normalized, ...desired, active: true }).select("id").single();
      if (stagedError) throw stagedError;
      return staged.id;
    }
    const exactAddress = Boolean(event.venue.address && match.address_line_1 && normalizeText(event.venue.address) === normalizeText(match.address_line_1));
    if (exactAddress) {
      const patch: Record<string, unknown> = {
        name: cleanName,
        normalized_name: normalized,
        address_line_1: event.venue.address,
        locality: event.venue.city,
        region: event.venue.region,
        postal_code: event.venue.postalCode
      };
      if (event.venue.latitude != null) patch.latitude = event.venue.latitude;
      if (event.venue.longitude != null) patch.longitude = event.venue.longitude;
      const { error:updateError } = await supabase.from("venues").update(patch).eq("id", match.id);
      if (updateError) throw updateError;
    } else if (!match.address_line_1) {
      const patch: Record<string, unknown> = { name: cleanName, normalized_name: normalized };
      if (event.venue.address) patch.address_line_1 = event.venue.address;
      if (event.venue.city) patch.locality = event.venue.city;
      if (event.venue.region) patch.region = event.venue.region;
      if (event.venue.postalCode) patch.postal_code = event.venue.postalCode;
      if (event.venue.latitude != null) patch.latitude = event.venue.latitude;
      if (event.venue.longitude != null) patch.longitude = event.venue.longitude;
      const { error:updateError } = await supabase.from("venues").update(patch).eq("id", match.id);
      if (updateError) throw updateError;
    }
    return match.id;
  }
  const { data: created, error: createError } = await supabase.from("venues").insert({ city_id: marketCityId, name: desired.name, normalized_name: normalized, address_line_1: desired.address_line_1, postal_code: desired.postal_code, latitude: desired.latitude, longitude: desired.longitude, locality: desired.locality, region: desired.region, active: true }).select("id").single();
  if (createError) throw createError;
  return created.id;
}

async function candidateEvent(supabase: SupabaseLike, marketCityId: string, event: CanonicalEvent) { const normalizedTitle = normalizeText(event.title); const ms = new Date(event.startAt).getTime(); const start = new Date(ms - 2 * 60 * 60 * 1000).toISOString(); const end = new Date(ms + 2 * 60 * 60 * 1000).toISOString(); const { data, error } = await supabase.from("events").select("id,title,start_at,venues(normalized_name)").eq("city_id", marketCityId).eq("normalized_title", normalizedTitle).gte("start_at", start).lte("start_at", end).limit(20); if (error) throw error; return obviousDuplicate({ title: event.title, startAt: event.startAt, venueName: event.venue.name }, (data ?? []).map((row: any) => ({ id: row.id, title: row.title, startAt: row.start_at, venueName: (Array.isArray(row.venues) ? row.venues[0] : row.venues)?.normalized_name ?? null }))); }
function eventPatch(event: CanonicalEvent, marketCityId: string, venueId: string | null) { return { city_id: marketCityId, venue_id: venueId, title: event.title, normalized_title: normalizeText(event.title), factual_description: event.description, start_at: event.startAt, end_at: event.endAt, timezone: event.timezone, is_all_day: event.isAllDay, is_free: event.isFree, event_url: event.eventUrl, official_url: event.officialUrl, ticket_url: event.ticketUrl, hero_image_url: event.imageUrl, status: "active", last_verified_at: event.ingestedAt, updated_at: event.ingestedAt }; }
function one(value: any) { return Array.isArray(value) ? value[0] : value; }
function comparable(field: string, value: any) {
  if (value == null) return null;
  if (["start_at", "end_at", "doors_at"].includes(field)) return new Date(value).toISOString();
  if (typeof value === "string") return value.replace(/\s+/g, " ").trim();
  return value;
}
function changed(field: string, oldValue: any, proposedValue: any) { return JSON.stringify(comparable(field, oldValue)) !== JSON.stringify(comparable(field, proposedValue)); }
async function storeCanonicalEvent(supabase: SupabaseLike, source: any, runId: string, event: CanonicalEvent, sweepRunId: string | null = null) {
  const { data: obs, error: lookupError } = await supabase.from("event_sources").select("id,event_id").eq("source_id", source.id).eq("external_id", event.sourceExternalId).maybeSingle(); if (lookupError) throw lookupError;
  let eventId = obs?.event_id ?? null; let disposition: "created" | "source_match" | "dedupe_match" = "source_match";
  if (!eventId) { const duplicate = await candidateEvent(supabase, source.city_id, event); if (duplicate) { eventId = duplicate.id; disposition = "dedupe_match"; } }
  let current: any = null; let currentVenue: any = null; let protectedEvent = false;
  if (eventId) {
    const { data, error } = await supabase.from("events").select("*,venues(id,name,address_line_1,locality,region,postal_code,latitude,longitude),event_editorial(data_review_state)").eq("id", eventId).single();
    if (error) throw error;
    current = data; currentVenue = one(data.venues); protectedEvent = one(data.event_editorial)?.data_review_state === "approved";
  }
  const venueId = await resolveVenue(supabase, source.city_id, event, { allowUpdates: !protectedEvent, fallbackVenue: protectedEvent ? currentVenue : null });
  if (!eventId) { const externalHash = (await sha256(event.sourceExternalId)).slice(0, 8); const localDate = ((event.rawPayload.jsonLdEvent as any)?.startDate as string | undefined)?.slice(0,10) ?? event.startAt.slice(0,10); const slug = `${slugify(event.title)}-${localDate}-${externalHash}`; const { data: created, error } = await supabase.from("events").insert({ ...eventPatch(event, source.city_id, venueId), slug, first_seen_at: event.ingestedAt }).select("id").single(); if (error) throw error; eventId = created.id; disposition = "created"; }
  else if (protectedEvent) { const { error } = await supabase.from("events").update({ last_verified_at: event.ingestedAt, updated_at: event.ingestedAt }).eq("id", eventId); if (error) throw error; }
  else { const { error } = await supabase.from("events").update(eventPatch(event, source.city_id, venueId)).eq("id", eventId); if (error) throw error; }
  const { error: editorialError } = await supabase.from("event_editorial").upsert({ event_id: eventId }, { onConflict: "event_id", ignoreDuplicates: true }); if (editorialError) throw editorialError;
  const contentHash = await sha256(event.rawText); const observationPatch = { event_id: eventId, source_run_id: runId, source_url: event.sourceUrl, raw_text: event.rawText, raw_payload: event.rawPayload, extracted_payload: { title: event.title, startAt: event.startAt, endAt: event.endAt, isAllDay: event.isAllDay, venue: event.venue, eventUrl: event.eventUrl, officialUrl: event.officialUrl, ticketUrl: event.ticketUrl, admissionText: event.admissionText, isFree: event.isFree }, content_hash: contentHash, extraction_confidence: event.extractionConfidence, last_seen_at: event.ingestedAt };
  let observationId = obs?.id ?? null;
  if (obs) { const { data, error } = await supabase.from("event_sources").update(observationPatch).eq("id", obs.id).select("id").single(); if (error) throw error; observationId = data.id; } else { const { data, error } = await supabase.from("event_sources").insert({ source_id: source.id, external_id: event.sourceExternalId, discovered_at: event.ingestedAt, ...observationPatch }).select("id").single(); if (error) throw error; observationId = data.id; }

  let proposalsCreated = 0;
  if (protectedEvent && current) {
    const { data: proposedVenue, error: venueError } = venueId ? await supabase.from("venues").select("id,name,address_line_1,locality,region,postal_code,latitude,longitude").eq("id", venueId).single() : { data: null, error: null };
    if (venueError) throw venueError;
    const incoming = eventPatch(event, source.city_id, venueId) as Record<string, any>;
    const material = ["title", "factual_description", "start_at", "end_at", "timezone", "status", "is_free", "official_url", "ticket_url", "hero_image_url", "is_all_day", "event_url"];
    const proposals: any[] = [];
    for (const field of material) {
      if (!changed(field, current[field], incoming[field])) continue;
      const fingerprint = await sha256(field + ":" + JSON.stringify(comparable(field, current[field])) + ":" + JSON.stringify(comparable(field, incoming[field])));
      proposals.push({ event_id: eventId, sweep_run_id: sweepRunId, source_run_id: runId, observation_id: observationId, field_name: field, old_value: current[field], proposed_value: incoming[field], evidence_excerpt: stripTags(event.rawText).slice(0, 500), proposal_fingerprint: fingerprint });
    }
    const oldVenue = venueSnapshot(currentVenue, current.venue_id);
    const newVenue = venueSnapshot(proposedVenue, venueId);
    if (JSON.stringify(oldVenue) !== JSON.stringify(newVenue)) {
      const fingerprint = await sha256("venue:" + JSON.stringify(oldVenue) + ":" + JSON.stringify(newVenue));
      proposals.push({ event_id: eventId, sweep_run_id: sweepRunId, source_run_id: runId, observation_id: observationId, field_name: "venue", old_value: oldVenue, proposed_value: newVenue, evidence_excerpt: stripTags(event.rawText).slice(0, 500), proposal_fingerprint: fingerprint });
    }
    if (proposals.length) {
      const { data, error } = await supabase.from("event_change_proposals").upsert(proposals, { onConflict: "event_id,proposal_fingerprint", ignoreDuplicates: true }).select("id");
      if (error) throw error;
      proposalsCreated = data?.length ?? 0;
    }
  }
  return { eventId, disposition, proposalsCreated };
}

type IngestionOptions = { limit?: number; offset?: number; dryRun?: boolean; concurrency?: number; sweepRunId?: string | null };
async function mapConcurrent<T,R>(items:T[], concurrency:number, worker:(item:T)=>Promise<R>) { const results=new Array<R>(items.length); let cursor=0; async function runner(){while(true){const index=cursor++; if(index>=items.length)return; results[index]=await worker(items[index]);}} await Promise.all(Array.from({length:Math.min(concurrency,items.length)},runner)); return results; }
function publicExample(event: CanonicalEvent) { return { title:event.title,startAt:event.startAt,endAt:event.endAt,isAllDay:event.isAllDay,venue:event.venue,isFree:event.isFree,sourceUrl:event.sourceUrl,imageUrl:event.imageUrl }; }
async function runIngestion(supabase:SupabaseLike, adapter:SourceAdapter, options:IngestionOptions={}) {
  const started=Date.now(); const {data:source,error:sourceError}=await supabase.from("sources").select("*").eq("parser_key",adapter.key).eq("active",true).maybeSingle(); if(sourceError)throw sourceError; if(!source)throw new Error(`No active source configured for adapter ${adapter.key}`);
  const {data:run,error:runError}=await supabase.from("source_runs").insert({source_id:source.id,status:"running",sweep_run_id:options.sweepRunId??null}).select("id").single(); if(runError)throw runError;
  const errors:Array<{url?:string;message:string}>=[]; let created=0,matched=0,sourceMatched=0,dedupeMatched=0,skipped=0,proposalsCreated=0; const examples:ReturnType<typeof publicExample>[]=[];
  try { const discovered=await adapter.discover(); const offset=Math.max(0,options.offset??0); const limit=Math.max(1,Math.min(options.limit??discovered.length,400)); const slice=discovered.slice(offset,offset+limit); const extracted=await mapConcurrent(slice,Math.max(1,Math.min(options.concurrency??8,12)),async(item)=>{try{const event=await adapter.fetchAndNormalize(item);if(!event)skipped+=1;return{item,event};}catch(error){errors.push({url:item.url,message:error instanceof Error?error.message:String(error)});return{item,event:null};}});
    for(const {event} of extracted){if(!event)continue;if(examples.length<12)examples.push(publicExample(event));if(options.dryRun)continue;try{const stored=await storeCanonicalEvent(supabase,source,run.id,event,options.sweepRunId??null);proposalsCreated+=stored.proposalsCreated;if(stored.disposition==="created") created+=1; else { matched+=1; if(stored.disposition==="source_match") sourceMatched+=1; else dedupeMatched+=1; }}catch(error){errors.push({url:event.sourceUrl,message:error instanceof Error?error.message:String(error)});}}
    const processed=extracted.filter((x)=>x.event).length; const status=errors.length===0?"success":processed>0?"partial":"failed"; const finishedAt=new Date().toISOString(); await supabase.from("source_runs").update({status,finished_at:finishedAt,observations_found:processed,events_created:created,events_matched:matched,error_count:errors.length,error_details:errors.slice(0,100),metadata:{adapter:adapter.key,total_discovered:discovered.length,requested_offset:offset,requested_limit:limit,skipped_non_events:skipped,dry_run:Boolean(options.dryRun),source_matches:sourceMatched,dedupe_matches:dedupeMatched,proposed_changes:proposalsCreated,duration_ms:Date.now()-started}}).eq("id",run.id); await supabase.from("sources").update({last_checked_at:finishedAt,...(status!=="failed"?{last_success_at:finishedAt}:{})}).eq("id",source.id); return {runId:run.id,status,totalDiscovered:discovered.length,attempted:slice.length,extracted:processed,created,matched,skipped,proposalsCreated,errors:errors.slice(0,25),examples,durationMs:Date.now()-started};
  } catch(error){const message=error instanceof Error?error.message:String(error);await supabase.from("source_runs").update({status:"failed",finished_at:new Date().toISOString(),error_count:errors.length+1,error_details:[...errors,{message}].slice(0,100),metadata:{adapter:adapter.key,duration_ms:Date.now()-started}}).eq("id",run.id);await supabase.from("sources").update({last_checked_at:new Date().toISOString()}).eq("id",source.id);throw error;}
}
const adapters=new Map([[visitElPasoAdapter.key,visitElPasoAdapter],[ktepAdapter.key,ktepAdapter],[elPasoLiveAdapter.key,elPasoLiveAdapter],[loveBuzzAdapter.key,loveBuzzAdapter],[lowbrowAdapter.key,lowbrowAdapter],[falstaffAdapter.key,falstaffAdapter],[versoAdapter.key,versoAdapter]]);
Deno.serve(async(request)=>{if(request.method!=="POST")return Response.json({error:"method_not_allowed"},{status:405});try{const body=await request.json().catch(()=>({}));const sourceKey=typeof body.sourceKey==="string"?body.sourceKey:"visit-el-paso";const adapter=adapters.get(sourceKey);if(!adapter)return Response.json({error:"unknown_source",sourceKey},{status:400});const supabase=createClient(Deno.env.get("SUPABASE_URL")??"",Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")??"",{auth:{persistSession:false,autoRefreshToken:false}});const result=await runIngestion(supabase,adapter,{limit:typeof body.limit==="number"?body.limit:50,offset:typeof body.offset==="number"?body.offset:undefined,dryRun:body.dryRun===true,concurrency:typeof body.concurrency==="number"?body.concurrency:undefined,sweepRunId:typeof body.sweepRunId==="string"?body.sweepRunId:null});return Response.json(result);}catch(error){console.error(error);return Response.json({error:error instanceof Error?error.message:String(error)},{status:500});}});
