"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../../../lib/supabase";
import { createCarousel, listCities, listPublicationDrafts } from "../../../lib/publishing-client";

const STATUS = ["", "draft", "ready", "posted", "skipped"];
const titleFor = item => item.content?.title || "Untitled carousel";
const dateFor = value => value ? new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "America/Denver" }).format(new Date(value)) : "—";

export default function PublishingPage() {
  const router = useRouter();
  const [rows, setRows] = useState([]);
  const [cities, setCities] = useState([]);
  const [status, setStatus] = useState("");
  const [cityId, setCityId] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [requestId, setRequestId] = useState("");
  const [error, setError] = useState("");

  async function load(nextStatus = status) {
    setLoading(true); setError("");
    try {
      const [drafts, cityRows] = await Promise.all([listPublicationDrafts(nextStatus), listCities()]);
      setRows(drafts || []); setCities(cityRows || []); setCityId(current => current || cityRows?.[0]?.id || "");
    } catch (caught) { setError(caught.message); }
    setLoading(false);
  }

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (!data.session) { router.replace("/login"); return; }
      await load("");
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  const counts = useMemo(() => rows.reduce((all, row) => ({ ...all, [row.status]: (all[row.status] || 0) + 1 }), {}), [rows]);

  async function filter(next) { setStatus(next); await load(next); }
  async function createNewCarousel() {
    if (!cityId || busy) return;
    setBusy(true); setError("");
    const nextRequestId = requestId || crypto.randomUUID();
    setRequestId(nextRequestId);
    try {
      const id = await createCarousel(cityId, nextRequestId);
      const seedEvent = new URLSearchParams(window.location.search).get("event");
      setRequestId("");
      router.push(`/admin/publishing/${id}${seedEvent ? `?event=${encodeURIComponent(seedEvent)}` : ""}`);
    }
    catch (caught) { setError(caught.message); setBusy(false); }
  }

  if (loading) return <main className="page-shell">Loading Publishing Desk…</main>;
  return <main className="page-shell">
    <header className="topbar"><div><div className="brand-mark">HEY NOW</div><h1>Publishing Desk</h1><p className="muted">Curate approved events into Instagram carousels. Posting stays manual.</p><nav className="admin-nav"><Link href="/admin/events">Events</Link><Link href="/admin/sources">Sources</Link><Link href="/admin/review">Morning Review</Link><Link className="active" href="/admin/publishing">Publishing</Link></nav></div></header>
    {error ? <div className="error-card"><strong>Publishing Desk unavailable.</strong><br />{error}</div> : null}
    <section className="publishing-toolbar card">
      <div><h2>New Instagram carousel</h2><p className="muted">Choose 3–8 approved events, put them in order, and write one shared caption.</p></div>
      <div className="toolbar-actions"><select aria-label="City" value={cityId} onChange={event => setCityId(event.target.value)}>{cities.map(city => <option key={city.id} value={city.id}>{city.name}{city.state_region ? `, ${city.state_region}` : ""}</option>)}</select><button disabled={!cityId || busy} onClick={createNewCarousel}>{busy ? "Creating…" : "Create carousel"}</button></div>
    </section>
    <div className="registry-toolbar"><div><strong>{rows.length}</strong> drafts</div><div className="segmented">{STATUS.map(item => <button className={status === item ? "active" : ""} key={item || "all"} onClick={() => filter(item)}>{item || "all"}{!status && item ? ` ${counts[item] || 0}` : ""}</button>)}</div></div>
    {!rows.length ? <div className="empty-state"><h2>No {status || "carousel"} drafts</h2><p className="muted">Create your first Instagram carousel above.</p></div> : <div className="publishing-list">{rows.map(item => <Link className="publishing-row" href={`/admin/publishing/${item.id}`} key={item.id}><div><span className={`pill ${item.status === "ready" ? "good" : item.status === "skipped" ? "warn" : ""}`}>{item.status}</span><h2>{titleFor(item)}</h2><p className="muted">{item.content_draft_events?.[0]?.count || 0} events · {item.cities?.name || "Unknown city"} · updated {dateFor(item.updated_at)}</p></div><span>Open →</span></Link>)}</div>}
  </main>;
}

