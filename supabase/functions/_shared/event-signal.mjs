const text = value => typeof value === "string" ? value.trim() : "";
const one = value => Array.isArray(value) ? value[0] : value;

export function scoreEventSignal(event, now = new Date()) {
  const venue = one(event.venues) || {};
  const sources = (event.event_sources || []).map(row => one(row.sources)).filter(Boolean);
  const roles = new Set(sources.flatMap(source => source.source_roles || []));
  const uniqueness = Math.max(0, ...sources.map(source => Number(source.uniqueness_score) || 0));
  const daysAway = (new Date(event.start_at).getTime() - now.getTime()) / 86400000;
  const complete = Boolean(text(event.title) && event.start_at && text(venue.name));
  const rich = Boolean(text(event.factual_description) || text(event.hero_image_url));

  const local_relevance = text(venue.locality).toLowerCase() === "el paso" ? 2 : 1;
  const distinctiveness = uniqueness >= 4 || roles.has("edge") ? 2 : uniqueness >= 2 ? 1 : 0;
  const audience_fit = text(event.category) || (event.tags || []).length || roles.has("edge") ? 2 : 1;
  const timeliness = daysAway >= 0 && daysAway <= 7 ? 2 : daysAway <= 30 ? 1 : 0;
  const usefulness = complete && rich ? 2 : complete ? 1 : 0;
  const total_score = local_relevance + distinctiveness + audience_fit + timeliness + usefulness;

  const reasons = [];
  if (local_relevance === 2) reasons.push("El Paso-specific");
  if (distinctiveness === 2) reasons.push("hard-to-find or primary-source event");
  if (audience_fit === 2) reasons.push("clear audience fit");
  if (timeliness === 2) reasons.push("happening within seven days");
  if (usefulness === 2) reasons.push("strong factual and visual detail");
  if (!complete) reasons.push("missing a material fact");

  return {
    verification_state: complete ? "supported" : "incomplete",
    local_relevance,
    distinctiveness,
    audience_fit,
    timeliness,
    usefulness,
    total_score,
    rationale: reasons.length ? reasons.join(" · ") + "." : "Low-signal listing with limited differentiating detail.",
  };
}
