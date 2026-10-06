"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../../../lib/supabase";

const DAY = 86_400_000;
const dateInput = date => new Date(date).toISOString().slice(0, 10);
const dateKey = value => {
  const parts = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: "America/Denver" }).formatToParts(new Date(value));
  const part = type => parts.find(item => item.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
};
const startDefault = () => dateInput(new Date());
const endDefault = () => dateInput(Date.now() + 90 * DAY);
const one = value => Array.isArray(value) ? value[0] : value;
const reviewFor = event => one(event.event_editorial) || {};
const categoriesFor = event => (event.event_categories || []).map(link => one(link.categories)).filter(Boolean);
const sourcesFor = event => (event.event_sources || []).map(link => one(link.sources)).filter(Boolean);
const fmtDate = value => !value ? "—" : new Intl.DateTimeFormat("en-US", {
  weekday: "short", month: "short", day: "numeric", year: "numeric",
  hour: "numeric", minute: "2-digit", timeZone: "America/Denver"
}).format(new Date(value));
const fmtDay = value => new Intl.DateTimeFormat("en-US", {
  weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: "America/Denver"
}).format(new Date(value));

function Pill({ children, tone = "" }) {
  return <span className={`pill ${tone}`}>{children}</span>;
}

function ReviewPills({ event }) {
  const editorial = reviewFor(event);
  return (
    <div className="review-pills">
      <Pill tone={editorial.data_review_state === "approved" ? "good" : editorial.data_review_state === "rejected" ? "bad" : editorial.data_review_state === "needs_review" ? "warn" : ""}>D {editorial.data_review_state || "pending"}</Pill>
      <Pill tone={editorial.editorial_review_state === "approved" ? "good" : editorial.editorial_review_state === "rejected" ? "bad" : editorial.editorial_review_state === "needs_review" ? "warn" : ""}>E {editorial.editorial_review_state || "pending"}</Pill>
      <Pill tone={editorial.publication_review_state === "approved" ? "good" : editorial.publication_review_state === "rejected" ? "bad" : editorial.publication_review_state === "needs_review" ? "warn" : ""}>P {editorial.publication_review_state || "pending"}</Pill>
    </div>
  );
}

export default function EventsPage() {
  const router = useRouter();
  const [rows, setRows] = useState([]);
  const [categoryCatalog, setCategoryCatalog] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [q, setQ] = useState("");
  const [startDate, setStartDate] = useState(startDefault);
  const [endDate, setEndDate] = useState(endDefault);
  const [source, setSource] = useState("");
  const [venue, setVenue] = useState("");
  const [locality, setLocality] = useState("");
  const [status, setStatus] = useState("");
  const [reviewStage, setReviewStage] = useState("data_review_state");
  const [reviewState, setReviewState] = useState("");
  const [category, setCategory] = useState("");
  const [view, setView] = useState("calendar");

  useEffect(() => {
    (async () => {
      const { data: sessionData } = await supabase.auth.getSession();
      if (!sessionData.session) { router.replace("/login"); return; }

      const [{ data, error: queryError }, { data: categoryData, error: categoryError }] = await Promise.all([
        supabase
          .from("events")
          .select(`
            id,title,factual_description,start_at,end_at,status,is_all_day,last_verified_at,first_seen_at,
            venues(id,name,locality,region),
            event_editorial(data_review_state,editorial_review_state,publication_review_state),
            event_sources(source_id,sources(id,name)),
            event_categories(category_id,categories(id,name,slug))
          `)
          .order("start_at", { ascending: true })
          .limit(1000),
        supabase.from("categories").select("id,name,slug").eq("active", true).order("name"),
      ]);

      if (queryError || categoryError) setError(queryError?.message || categoryError?.message);
      else setRows(data || []);
      setCategoryCatalog(categoryData || []);
      setLoading(false);
    })();
  }, [router]);

  const options = useMemo(() => ({
    sources: [...new Map(rows.flatMap(sourcesFor).map(item => [item.id, item])).values()].sort((a, b) => a.name.localeCompare(b.name)),
    venues: [...new Map(rows.map(row => one(row.venues)).filter(Boolean).map(item => [item.id, item])).values()].sort((a, b) => a.name.localeCompare(b.name)),
    localities: [...new Set(rows.map(row => one(row.venues)?.locality).filter(Boolean))].sort(),
    categories: categoryCatalog,
  }), [rows, categoryCatalog]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter(event => {
      const eventDay = dateKey(event.start_at);
      const eventVenue = one(event.venues);
      const eventSources = sourcesFor(event);
      const eventCategories = categoriesFor(event);
      const editorial = reviewFor(event);
      const haystack = [event.title, event.factual_description, eventVenue?.name, eventVenue?.locality, ...eventSources.map(item => item.name), ...eventCategories.map(item => item.name)].filter(Boolean).join(" ").toLowerCase();
      if (startDate && eventDay < startDate) return false;
      if (endDate && eventDay > endDate) return false;
      if (needle && !haystack.includes(needle)) return false;
      if (source && !eventSources.some(item => item.id === source)) return false;
      if (venue && eventVenue?.id !== venue) return false;
      if (locality && eventVenue?.locality !== locality) return false;
      if (status && event.status !== status) return false;
      if (reviewState && (editorial[reviewStage] || "pending") !== reviewState) return false;
      if (category && !eventCategories.some(item => item.id === category)) return false;
      return true;
    });
  }, [rows, q, startDate, endDate, source, venue, locality, status, reviewStage, reviewState, category]);

  const groups = useMemo(() => filtered.reduce((map, event) => {
    const key = dateKey(event.start_at);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(event);
    return map;
  }, new Map()), [filtered]);

  const metrics = useMemo(() => {
    const upcoming = rows.filter(row => new Date(row.start_at) >= new Date());
    return {
      upcoming: upcoming.length,
      nextSeven: upcoming.filter(row => new Date(row.start_at) < new Date(Date.now() + 7 * DAY)).length,
      pending: upcoming.filter(row => (reviewFor(row).data_review_state || "pending") === "pending").length,
      overlap: upcoming.filter(row => sourcesFor(row).length > 1).length,
    };
  }, [rows]);

  function clearFilters() {
    setQ(""); setStartDate(""); setEndDate(""); setSource(""); setVenue(""); setLocality("");
    setStatus(""); setReviewState(""); setCategory("");
  }

  async function logout() {
    await supabase.auth.signOut();
    router.replace("/login");
  }

  if (loading) return <main className="page-shell">Loading event registry…</main>;

  return (
    <main className="page-shell">
      <header className="topbar">
        <div>
          <div className="brand-mark">HEY NOW</div>
          <h1>Event Registry</h1>
          <p className="muted">Canonical inventory · live provenance · editorial review</p>
          <nav className="admin-nav"><Link className="active" href="/admin/events">Events</Link><Link href="/admin/sources">Sources</Link><Link href="/admin/review">Morning Review</Link><Link href="/admin/publishing">Publishing</Link></nav>
        </div>
        <button className="button secondary" onClick={logout}>Sign out</button>
      </header>

      {error ? <div className="error-card"><strong>Registry access failed.</strong><br />{error}<br /><span className="muted">This login may not yet be authorized in admin_users.</span></div> : null}

      <section className="metrics-grid" aria-label="Event registry metrics">
        <div className="metric"><strong>{metrics.upcoming}</strong><span>Upcoming</span></div>
        <div className="metric"><strong>{metrics.nextSeven}</strong><span>Next 7 days</span></div>
        <div className="metric"><strong>{metrics.pending}</strong><span>Awaiting data review</span></div>
        <div className="metric"><strong>{metrics.overlap}</strong><span>Multi-source</span></div>
      </section>

      <section className="event-filters">
        <input className="search-input" aria-label="Search events" placeholder="Search events, venues, sources…" value={q} onChange={event => setQ(event.target.value)} />
        <label><span>From</span><input type="date" value={startDate} onChange={event => setStartDate(event.target.value)} /></label>
        <label><span>Through</span><input type="date" value={endDate} onChange={event => setEndDate(event.target.value)} /></label>
        <select aria-label="Source" value={source} onChange={event => setSource(event.target.value)}><option value="">All sources</option>{options.sources.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
        <select aria-label="Venue" value={venue} onChange={event => setVenue(event.target.value)}><option value="">All venues</option>{options.venues.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
        <select aria-label="Locality" value={locality} onChange={event => setLocality(event.target.value)}><option value="">All localities</option>{options.localities.map(item => <option key={item}>{item}</option>)}</select>
        <select aria-label="Event status" value={status} onChange={event => setStatus(event.target.value)}><option value="">All statuses</option>{["active", "cancelled", "postponed", "sold_out", "expired"].map(item => <option key={item}>{item}</option>)}</select>
        <select aria-label="Review stage" value={reviewStage} onChange={event => setReviewStage(event.target.value)}><option value="data_review_state">Data review</option><option value="editorial_review_state">Editorial review</option><option value="publication_review_state">Publication review</option></select>
        <select aria-label="Review state" value={reviewState} onChange={event => setReviewState(event.target.value)}><option value="">All review states</option>{["pending", "approved", "rejected", "needs_review"].map(item => <option key={item}>{item}</option>)}</select>
        <select aria-label="Category" value={category} onChange={event => setCategory(event.target.value)}><option value="">All categories</option>{options.categories.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
      </section>

      <div className="registry-toolbar">
        <div><strong>{filtered.length}</strong> events shown</div>
        <div className="toolbar-actions"><button className="text-button" onClick={clearFilters}>Clear filters</button><div className="segmented"><button className={view === "calendar" ? "active" : ""} onClick={() => setView("calendar")}>Calendar</button><button className={view === "table" ? "active" : ""} onClick={() => setView("table")}>Table</button></div></div>
      </div>

      {!filtered.length ? <div className="empty-state"><h2>No events match</h2><p className="muted">Try widening the dates or clearing one of the filters.</p></div> : null}

      {view === "calendar" && filtered.length ? <div className="calendar-list">{[...groups.entries()].map(([day, events]) => (
        <section className="calendar-day" key={day}>
          <div className="calendar-date"><strong>{day.slice(8)}</strong><span>{fmtDay(events[0].start_at)}</span></div>
          <div className="calendar-events">{events.map(event => {
            const eventVenue = one(event.venues);
            const eventSources = sourcesFor(event);
            return <Link className="calendar-event" href={`/admin/events/${event.id}`} key={event.id}>
              <div className="event-time">{event.is_all_day ? "All day" : new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/Denver" }).format(new Date(event.start_at))}</div>
              <div><strong>{event.title}</strong><div className="sub">{eventVenue?.name || "Venue unassigned"}{eventVenue?.locality ? ` · ${eventVenue.locality}` : ""} · {eventSources.length} source{eventSources.length === 1 ? "" : "s"}</div></div>
              <ReviewPills event={event} />
            </Link>;
          })}</div>
        </section>
      ))}</div> : null}

      {view === "table" && filtered.length ? <div className="table-wrap"><table className="events-table">
        <thead><tr><th>Date</th><th>Event</th><th>Venue / locality</th><th>Sources</th><th>Category</th><th>Status</th><th>Review</th><th>Verified</th></tr></thead>
        <tbody>{filtered.map(event => {
          const eventVenue = one(event.venues);
          const eventSources = sourcesFor(event);
          return <tr key={event.id} onClick={() => router.push(`/admin/events/${event.id}`)}>
            <td>{fmtDate(event.start_at)}</td>
            <td><strong>{event.title}</strong></td>
            <td>{eventVenue?.name || "—"}<div className="sub">{eventVenue?.locality || "Unknown locality"}</div></td>
            <td>{eventSources.map(item => item.name).join(", ") || "—"}</td>
            <td>{categoriesFor(event).map(item => item.name).join(", ") || "—"}</td>
            <td><Pill>{event.status}</Pill></td>
            <td><ReviewPills event={event} /></td>
            <td>{fmtDate(event.last_verified_at)}</td>
          </tr>;
        })}</tbody>
      </table></div> : null}
    </main>
  );
}
