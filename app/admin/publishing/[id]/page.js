"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "../../../../lib/supabase";
import { listCarouselCandidates, loadPublicationDraft, saveCarousel, transitionCarousel } from "../../../../lib/publishing-client";
import { carouselReadinessErrors, isInstagramUrl, normalizeCarouselContent } from "../../../../lib/publishing-validation.mjs";
import { buildCarouselSlides, renderCarouselSlide, slideFilename } from "../../../../lib/carousel-assets.mjs";

const EMPTY = normalizeCarouselContent({});
const formatDate = value => value ? new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "America/Denver" }).format(new Date(value)) : "Date TBA";

export default function PublishingEditorPage() {
  const { id } = useParams();
  const router = useRouter();
  const [draft, setDraft] = useState(null);
  const [content, setContent] = useState(EMPTY);
  const [candidates, setCandidates] = useState([]);
  const [selectedIds, setSelectedIds] = useState([]);
  const [instagramUrl, setInstagramUrl] = useState("");
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [assets, setAssets] = useState([]);
  const [assetBusy, setAssetBusy] = useState(false);

  const load = useCallback(async () => {
    const { data } = await supabase.auth.getSession();
    if (!data.session) { router.replace("/login"); return; }
    try {
      const row = await loadPublicationDraft(id);
      if (!row) { setError("Carousel not found."); return; }
      const eventRows = [...(row.content_draft_events || [])].sort((a, b) => a.position - b.position);
      const candidateRows = await listCarouselCandidates(row.city_id);
      setDraft(row);
      setContent(normalizeCarouselContent(row.content));
      const existingIds = eventRows.map(item => item.event_id);
      const seedEvent = new URLSearchParams(window.location.search).get("event");
      setSelectedIds(seedEvent && candidateRows?.some(item => item.event_id === seedEvent) && !existingIds.includes(seedEvent) && existingIds.length < 8 ? [...existingIds, seedEvent] : existingIds);
      setCandidates(candidateRows || []);
      setInstagramUrl(row.instagram_url || "");
    } catch (caught) { setError(caught.message); }
  }, [id, router]);

  useEffect(() => { load(); }, [load]);

  const candidateById = useMemo(() => new Map(candidates.map(item => [item.event_id, item])), [candidates]);
  const currentById = useMemo(() => new Map((draft?.content_draft_events || []).map(item => [item.event_id, item])), [draft]);
  const selected = selectedIds.map(eventId => {
    const candidate = candidateById.get(eventId);
    const current = currentById.get(eventId);
    return {
      ...(current?.fact_snapshot || {}),
      ...(candidate || {}),
      event_id: eventId,
      title: candidate?.title || current?.fact_snapshot?.title || current?.events?.title || "Unavailable event",
      start_at: candidate?.start_at || current?.fact_snapshot?.start_at || current?.events?.start_at,
      venue: candidate?.venue || current?.fact_snapshot?.venue || "Venue TBA",
      locality: candidate?.locality || current?.fact_snapshot?.locality || "",
      data_review_state: candidate?.data_review_state || current?.fact_snapshot?.data_review_state || "pending",
    };
  });
  const visibleCandidates = candidates.filter(item => {
    if (selectedIds.includes(item.event_id)) return false;
    const needle = search.trim().toLowerCase();
    return !needle || `${item.title} ${item.venue || ""} ${item.locality || ""}`.toLowerCase().includes(needle);
  });
  const readyIssues = carouselReadinessErrors(content, selectedIds.length, selected.filter(item => item.data_review_state !== "approved").length);
  const locked = draft?.status !== "draft";

  function addEvent(eventId) {
    if (locked || selectedIds.length >= 8 || selectedIds.includes(eventId)) return;
    setSelectedIds(current => [...current, eventId]);
  }

  function removeEvent(eventId) {
    if (!locked) setSelectedIds(current => current.filter(item => item !== eventId));
  }

  function moveEvent(index, direction) {
    if (locked) return;
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= selectedIds.length) return;
    setSelectedIds(current => {
      const next = [...current];
      [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
      return next;
    });
  }

  async function save() {
    if (!draft || busy || locked) return false;
    setBusy("save"); setError(""); setMessage("");
    try {
      const next = normalizeCarouselContent(content);
      const revision = await saveCarousel(draft.id, next, selectedIds, draft.revision);
      setDraft(current => ({ ...current, content: next, revision }));
      setContent(next); setMessage("Carousel saved."); setBusy(""); return true;
    } catch (caught) {
      setError(caught.message);
      if (caught.code === "40001" || caught.message?.includes("changed elsewhere")) await load();
      setBusy(""); return false;
    }
  }

  async function transition(target) {
    if (!draft || busy) return;
    if (target === "ready" && Object.keys(readyIssues).length) { setError(Object.values(readyIssues)[0]); return; }
    if (target === "posted" && !isInstagramUrl(instagramUrl)) { setError("Enter a valid HTTPS instagram.com URL."); return; }
    setBusy(target); setError(""); setMessage("");
    try {
      const editable = draft.status === "draft";
      const next = editable ? normalizeCarouselContent(content) : null;
      const revision = await transitionCarousel(draft.id, target, { instagram_url: instagramUrl }, draft.revision, next, editable ? selectedIds : null);
      setDraft(current => ({ ...current, content: next || current.content, status: target, revision, instagram_url: target === "posted" ? instagramUrl : current.instagram_url }));
      if (next) setContent(next);
      setMessage(target === "posted" ? "Instagram post recorded." : `Carousel moved to ${target}.`);
      setBusy("");
    } catch (caught) {
      setError(caught.message);
      if (caught.code === "40001" || caught.message?.includes("changed elsewhere")) await load();
      setBusy("");
    }
  }

  async function copyCaption() {
    setError(""); setMessage("");
    try { await navigator.clipboard.writeText(content.caption); setMessage("Caption copied."); }
    catch { setError("Could not copy the caption."); }
  }

  async function generateAssets() {
    setAssetBusy(true); setError(""); setMessage("");
    try {
      const slides = buildCarouselSlides(content, selected);
      const rendered = await Promise.all(slides.map(async (slide, index) => {
        const canvas = document.createElement("canvas");
        renderCarouselSlide(canvas, slide, index, slides.length);
        const blob = await new Promise((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error("Could not create PNG.")), "image/png"));
        return { slide, filename: slideFilename(index, slide), blob, url: URL.createObjectURL(blob) };
      }));
      assets.forEach(asset => URL.revokeObjectURL(asset.url));
      setAssets(rendered);
      setMessage(`${rendered.length} exact-size PNG previews generated.`);
    } catch (caught) { setError(caught.message || "Could not generate carousel assets."); }
    setAssetBusy(false);
  }

  async function downloadAsset(asset) {
    const file = new File([asset.blob], asset.filename, { type: "image/png" });
    if (navigator.canShare?.({ files: [file] })) {
      try { await navigator.share({ files: [file], title: asset.filename }); return; }
      catch (caught) { if (caught.name === "AbortError") return; }
    }
    const link = document.createElement("a");
    link.download = asset.filename;
    link.href = asset.url;
    link.click();
  }

  async function saveAllAssets() {
    if (!assets.length) return;
    const files = assets.map(asset => new File([asset.blob], asset.filename, { type: "image/png" }));
    if (navigator.canShare?.({ files })) {
      try { await navigator.share({ files, title: content.title || "HeyNow carousel" }); return; }
      catch (caught) { if (caught.name === "AbortError") return; }
    }
    if (navigator.canShare?.({ files: [files[0]] })) {
      setMessage("This phone saves one image at a time. Use each Save / share PNG button below.");
      return;
    }
    assets.forEach((asset, index) => setTimeout(() => downloadAsset(asset), index * 250));
  }

  if (!draft && !error) return <main className="page-shell">Loading carousel…</main>;
  if (!draft) return <main className="page-shell"><Link href="/admin/publishing">← Publishing Desk</Link><div className="error-card">{error}</div></main>;

  return <main className="page-shell publishing-editor">
    <div className="detail-breadcrumbs"><Link href="/admin/publishing">← Publishing Desk</Link></div>
    <header className="detail-header"><div><div className="brand-mark">HEY NOW</div><h1>{content.title || "Untitled carousel"}</h1><p className="muted">Instagram carousel · {selectedIds.length} events · revision {draft.revision}</p></div><span className={`pill ${draft.status === "ready" ? "good" : ""}`}>{draft.status}</span></header>
    {error ? <div className="error-card">{error}</div> : null}{message ? <div className="success-card">{message}</div> : null}

    <div className="publishing-editor-grid">
      <section>
        <section className="card publishing-form"><h2>Carousel package</h2>
          <label><span>Carousel title <small>{content.title.length}/90</small></span><input disabled={locked} value={content.title} onChange={event => setContent({ ...content, title: event.target.value })} maxLength="90" placeholder="This weekend in El Paso" /></label>
          <label><span>Cover kicker</span><input disabled={locked} value={content.cover_kicker} onChange={event => setContent({ ...content, cover_kicker: event.target.value })} placeholder="HEY NOW PICKS" /></label>
          <label><span>Instagram caption <small>{content.caption.length}/2200</small></span><textarea disabled={locked} rows="9" value={content.caption} onChange={event => setContent({ ...content, caption: event.target.value })} maxLength="2200" /></label>
          <button className="secondary" disabled={!content.caption} onClick={copyCaption}>Copy caption</button>
        </section>

        <section className="card carousel-events"><div className="section-heading"><div><h2>Carousel order</h2><p className="muted">Cover first, then one slide for each event.</p></div><strong>{selectedIds.length}/8</strong></div>
          {!selected.length ? <p className="muted">No events selected yet.</p> : <ol className="selected-events">{selected.map((item, index) => <li key={item.event_id}><div><strong><Link href={`/admin/events/${item.event_id}`}>{item.title}</Link></strong><span>{formatDate(item.start_at)} · {item.venue || "Venue TBA"}{item.locality ? ` · ${item.locality}` : ""}</span><small className={item.data_review_state === "approved" ? "review-approved" : "review-pending"}>{item.data_review_state === "approved" ? "Data approved" : <Link href={`/admin/events/${item.event_id}`}>Needs data review — open event →</Link>}</small></div>{!locked ? <div className="order-actions"><button className="secondary compact" disabled={index === 0} onClick={() => moveEvent(index, -1)} aria-label={`Move ${item.title} up`}>↑</button><button className="secondary compact" disabled={index === selected.length - 1} onClick={() => moveEvent(index, 1)} aria-label={`Move ${item.title} down`}>↓</button><button className="secondary compact" onClick={() => removeEvent(item.event_id)}>Remove</button></div> : null}</li>)}</ol>}
        </section>

        <section className="card asset-studio"><div className="section-heading"><div><h2>Instagram assets</h2><p className="muted">One cover plus one 1080×1350 PNG per event. Regenerate after editorial changes.</p></div><button disabled={assetBusy || !content.title || !selected.length} onClick={generateAssets}>{assetBusy ? "Generating…" : "Generate previews"}</button></div>
          {!assets.length ? <div className="asset-empty">No assets generated yet. Missing photography uses HeyNow’s poster treatment.</div> : <><div className="asset-save-all"><button onClick={saveAllAssets}>Save / share all PNGs</button><small className="muted">On phones, choose Save Images or Save to Files in the share sheet.</small></div><div className="asset-grid">{assets.map((asset, index) => <article className="asset-preview" key={asset.filename}><img src={asset.url} alt={asset.slide.kind === "cover" ? "Carousel cover preview" : `${asset.slide.title} event slide preview`} /><div><strong>{index + 1}. {asset.slide.kind === "cover" ? "Cover" : <Link href={`/admin/events/${asset.slide.event_id}`}>{asset.slide.title}</Link>}</strong><button className="secondary compact" onClick={() => downloadAsset(asset)}>Save / share PNG</button></div></article>)}</div></>}
        </section>

        {!locked ? <section className="card event-picker"><h2>Add upcoming events</h2><p className="muted">You can draft with pending events; every selection must be data-approved before Ready.</p><input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search event or venue" /><div className="candidate-events">{visibleCandidates.slice(0, 80).map(item => <div className="candidate-event" key={item.event_id}><span><strong><Link href={`/admin/events/${item.event_id}`}>{item.title}</Link></strong><small>{formatDate(item.start_at)} · {item.venue || "Venue TBA"} · {item.data_review_state === "approved" ? "approved" : "needs review"}</small></span><button className="secondary compact" disabled={selectedIds.length >= 8} onClick={() => addEvent(item.event_id)}>+ Add</button></div>)}</div>{!visibleCandidates.length ? <p className="muted">No matching upcoming events.</p> : null}</section> : null}
      </section>

      <aside>
        <section className="card"><h2>Ready checklist</h2>{Object.keys(readyIssues).length ? <ul className="readiness-list">{Object.values(readyIssues).map(issue => <li key={issue}>{issue}</li>)}</ul> : <p className="success-text">Ready to mark for publishing.</p>}</section>
        <section className="card"><h2>Workflow</h2>
          {draft.status === "draft" ? <><button disabled={Boolean(busy)} onClick={save}>{busy === "save" ? "Saving…" : "Save draft"}</button><button disabled={Boolean(busy) || Object.keys(readyIssues).length > 0} onClick={() => transition("ready")}>{busy === "ready" ? "Saving…" : "Save & mark ready"}</button><button className="secondary" disabled={Boolean(busy)} onClick={() => transition("skipped")}>Save & skip</button></> : null}
          {draft.status === "ready" ? <><label><span>Instagram post URL</span><input type="url" inputMode="url" autoCapitalize="none" placeholder="https://www.instagram.com/p/…" value={instagramUrl} onChange={event => setInstagramUrl(event.target.value)} /></label><button disabled={Boolean(busy)} onClick={() => transition("posted")}>Record as posted</button><button className="secondary" disabled={Boolean(busy)} onClick={() => transition("draft")}>Return to draft</button><button className="secondary" disabled={Boolean(busy)} onClick={() => transition("skipped")}>Skip</button></> : null}
          {draft.status === "skipped" ? <button disabled={Boolean(busy)} onClick={() => transition("draft")}>Restore draft</button> : null}
          {draft.status === "posted" ? <p><a href={draft.instagram_url} target="_blank" rel="noreferrer">Open Instagram post ↗</a></p> : null}
        </section>
      </aside>
    </div>
  </main>;
}
