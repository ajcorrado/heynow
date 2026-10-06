"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { supabase } from "../../../../lib/supabase";
import { loadPublicationDraft, saveDraft, transitionDraft } from "../../../../lib/publishing-client";
import { normalizeContent, readinessErrors, transitionErrors } from "../../../../lib/publishing-validation.mjs";

const EMPTY = normalizeContent({});
const field = (content, key, value) => ({ ...content, [key]: value });
const fact = (content, key, value) => ({ ...content, display_facts: { ...content.display_facts, [key]: value } });

export default function PublishingEditorPage() {
  const { id } = useParams();
  const router = useRouter();
  const [draft, setDraft] = useState(null);
  const [content, setContent] = useState(EMPTY);
  const [instagramUrl, setInstagramUrl] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    const { data } = await supabase.auth.getSession();
    if (!data.session) { router.replace("/login"); return; }
    try {
      const row = await loadPublicationDraft(id);
      if (!row) { setError("Draft not found."); return; }
      setDraft(row); setContent(normalizeContent(row.content)); setInstagramUrl(row.instagram_url || "");
    } catch (caught) { setError(caught.message); }
  }, [id, router]);
  useEffect(() => { load(); }, [load]);

  async function save() {
    if (!draft || busy || draft.status === "posted") return false;
    setBusy("save"); setError(""); setMessage("");
    try {
      const next = normalizeContent(content);
      const revision = await saveDraft(draft.id, next, draft.revision);
      setDraft(current => ({ ...current, content: next, revision })); setContent(next); setMessage("Draft saved."); setBusy(""); return true;
    } catch (caught) { setError(caught.message); setBusy(""); return false; }
  }

  async function transition(target) {
    if (!draft || busy) return;
    const clientErrors = transitionErrors(draft.status, target, content, { instagram_url: instagramUrl });
    if (Object.keys(clientErrors).length) { setError(Object.values(clientErrors)[0]); return; }
    setBusy(target); setError(""); setMessage("");
    try {
      let revision = draft.revision;
      if (draft.status !== "posted") {
        const next = normalizeContent(content);
        revision = await saveDraft(draft.id, next, revision);
        setContent(next);
      }
      revision = await transitionDraft(draft.id, target, { instagram_url: instagramUrl }, revision);
      setDraft(current => ({ ...current, content: normalizeContent(content), status: target, revision, instagram_url: target === "posted" ? instagramUrl : current.instagram_url }));
      setMessage(target === "posted" ? "Instagram post recorded." : `Draft moved to ${target}.`); setBusy("");
    } catch (caught) { setError(caught.message); setBusy(""); }
  }

  if (!draft && !error) return <main className="page-shell">Loading draft…</main>;
  if (!draft) return <main className="page-shell"><Link href="/admin/publishing">← Publishing Desk</Link><div className="error-card">{error}</div></main>;
  const locked = draft.status === "posted";
  const readyIssues = readinessErrors(content);
  return <main className="page-shell publishing-editor">
    <div className="detail-breadcrumbs"><Link href="/admin/publishing">← Publishing Desk</Link>{draft.event_id ? <Link href={`/admin/events/${draft.event_id}`}>Source event</Link> : null}</div>
    <header className="detail-header"><div><div className="brand-mark">HEY NOW</div><h1>{content.headline || "Untitled draft"}</h1><p className="muted">Instagram feed post · revision {draft.revision}</p></div><span className={`pill ${draft.status === "ready" ? "good" : ""}`}>{draft.status}</span></header>
    {draft.event_id ? null : <div className="warning-card"><strong>Manual draft.</strong> The facts below have not been inherited from a data-approved registry event.</div>}
    {error ? <div className="error-card">{error}</div> : null}{message ? <div className="success-card">{message}</div> : null}
    <div className="publishing-editor-grid">
      <section className="card publishing-form"><h2>Editorial package</h2>
        <label><span>Headline <small>{content.headline.length}/90</small></span><input disabled={locked} value={content.headline} onChange={e => setContent(field(content, "headline", e.target.value))} maxLength="90" /></label>
        <label><span>HeyNow take <small>{content.editorial_take.length}/500</small></span><textarea disabled={locked} rows="4" value={content.editorial_take} onChange={e => setContent(field(content, "editorial_take", e.target.value))} maxLength="500" /></label>
        <label><span>Instagram caption <small>{content.caption.length}/2200</small></span><textarea disabled={locked} rows="10" value={content.caption} onChange={e => setContent(field(content, "caption", e.target.value))} maxLength="2200" /></label>
        <h3>Display facts</h3><div className="display-facts-grid">{["date","time","venue","locality","price","age"].map(key => <label key={key}><span>{key}</span><input disabled={locked} value={content.display_facts[key]} onChange={e => setContent(fact(content, key, e.target.value))} /></label>)}</div>
        {!locked ? <button disabled={Boolean(busy)} onClick={save}>{busy === "save" ? "Saving…" : "Save draft"}</button> : null}
      </section>
      <aside><section className="card"><h2>Locked source snapshot</h2><p className="muted">This captured evidence never changes when you edit the post.</p><pre className="snapshot">{JSON.stringify(draft.fact_snapshot, null, 2)}</pre></section>
        <section className="card"><h2>Workflow</h2>{draft.status === "draft" ? <><button disabled={Boolean(busy) || Object.keys(readyIssues).length > 0} onClick={() => transition("ready")}>Mark ready</button> <button className="secondary" disabled={Boolean(busy)} onClick={() => transition("skipped")}>Skip</button>{Object.keys(readyIssues).length ? <p className="sub">Complete the required editorial fields to mark Ready.</p> : null}</> : null}{draft.status === "ready" ? <><label><span>Instagram post URL</span><input placeholder="https://www.instagram.com/p/…" value={instagramUrl} onChange={e => setInstagramUrl(e.target.value)} /></label><button disabled={Boolean(busy)} onClick={() => transition("posted")}>Record as posted</button> <button className="secondary" disabled={Boolean(busy)} onClick={() => transition("draft")}>Return to draft</button> <button className="secondary" disabled={Boolean(busy)} onClick={() => transition("skipped")}>Skip</button></> : null}{draft.status === "skipped" ? <button disabled={Boolean(busy)} onClick={() => transition("draft")}>Restore draft</button> : null}{draft.status === "posted" ? <p><a href={draft.instagram_url} target="_blank" rel="noreferrer">Open Instagram post ↗</a></p> : null}</section>
      </aside>
    </div>
  </main>;
}
