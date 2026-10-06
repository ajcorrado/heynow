"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { supabase } from "../../../../lib/supabase";
import { createDraftFromEvent } from "../../../../lib/publishing-client";

const REVIEW_STAGES = [
  { column: "data_review_state", label: "Data review", help: "Are the canonical facts trustworthy?" },
  { column: "editorial_review_state", label: "Editorial review", help: "Is this worth HeyNow editorial attention?" },
  { column: "publication_review_state", label: "Publication review", help: "Is this ready to appear publicly?" },
];
const one = value => Array.isArray(value) ? value[0] : value;
const fmtDate = value => !value ? "—" : new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium", timeStyle: "short", timeZone: "America/Denver"
}).format(new Date(value));
const fmtMoney = (min, max, currency = "USD") => {
  if (min == null && max == null) return "—";
  const format = cents => new Intl.NumberFormat("en-US", { style: "currency", currency: currency.trim() || "USD" }).format(cents / 100);
  return min != null && max != null && min !== max ? `${format(min)}–${format(max)}` : format(min ?? max);
};
const valueText = value => value && typeof value === "object" ? JSON.stringify(value, null, 2) : value == null ? "—" : String(value);

function Field({ label, children }) {
  return <div className="field"><div className="field-label">{label}</div><div>{children ?? "—"}</div></div>;
}

function StatePill({ value }) {
  const tone = value === "approved" ? "good" : value === "rejected" ? "bad" : value === "needs_review" ? "warn" : "";
  return <span className={`pill ${tone}`}>{value || "pending"}</span>;
}

export default function EventDetailPage() {
  const { id } = useParams();
  const router = useRouter();
  const [event, setEvent] = useState(null);
  const [reviews, setReviews] = useState([]);
  const [proposals, setProposals] = useState([]);
  const [user, setUser] = useState(null);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const { data: sessionData } = await supabase.auth.getSession();
    if (!sessionData.session) { router.replace("/login"); return; }
    setUser(sessionData.session.user);

    const [{ data: eventData, error: eventError }, { data: reviewData, error: reviewError }, { data: proposalData, error: proposalError }] = await Promise.all([
      supabase.from("events").select(`
        *,
        cities(id,name,state_region,country_code,timezone),
        venues(*),
        event_editorial(*),
        event_sources(*,sources(id,name,source_type,url,priority_tier),source_runs(id,status,started_at,finished_at,observations_found,events_created,events_matched,error_count)),
        event_categories(category_id,categories(id,name,slug)),
        event_organizers(role,organizers(id,name,organizer_type,website_url)),
        event_tags(tags(id,name,slug))
      `).eq("id", id).maybeSingle(),
      supabase.from("editorial_reviews").select("*").eq("event_id", id).order("created_at", { ascending: false }).limit(50),
      supabase.from("event_change_proposals").select("*,event_sources(source_url,sources(name))").eq("event_id", id).order("created_at", { ascending: false }).limit(100),
    ]);

    if (eventError || reviewError || proposalError) setError(eventError?.message || reviewError?.message || proposalError?.message);
    else { setEvent(eventData); setReviews(reviewData || []); setProposals(proposalData || []); }
  }, [id, router]);

  useEffect(() => { load(); }, [load]);

  async function review(stage, decision, auditDecision = decision) {
    if (!event || busy) return;
    setBusy(`${stage}:${auditDecision}`);
    setError(""); setMessage("");
    const editorial = one(event.event_editorial) || {};
    const previous = editorial[stage] || "pending";
    const { error: updateError } = await supabase.from("event_editorial").update({ [stage]: decision, updated_at: new Date().toISOString() }).eq("event_id", id);
    if (updateError) { setError(updateError.message); setBusy(""); return; }

    const { error: auditError } = await supabase.from("editorial_reviews").insert({
      event_id: id,
      reviewer_id: user?.id || null,
      review_stage: stage.replace("_review_state", ""),
      decision: auditDecision,
      previous_values: { [stage]: previous },
      new_values: { [stage]: decision },
      notes: notes.trim() || null,
    });
    if (auditError) setError(`State saved, but the review history entry failed: ${auditError.message}`);
    else setMessage(`${REVIEW_STAGES.find(item => item.column === stage)?.label || "Review"} saved.`);
    setNotes("");
    await load();
    setBusy("");
  }

  async function reviewProposal(proposalId, decision) {
    if (busy) return;
    setBusy(`proposal:${proposalId}`); setError(""); setMessage("");
    const { error: proposalError } = await supabase.rpc("review_event_change_proposal", {
      proposal_id: proposalId,
      review_decision: decision,
      review_notes: notes.trim() || null,
    });
    if (proposalError) setError(proposalError.message);
    else { setMessage(`Change ${decision}.`); setNotes(""); }
    await load();
    setBusy("");
  }

  async function openPublishingDraft() {
    if (busy) return;
    setBusy("publishing"); setError(""); setMessage("");
    try {
      const draftId = await createDraftFromEvent(id);
      router.push(`/admin/publishing/${draftId}`);
    } catch (caught) {
      setError(caught.message);
      setBusy("");
    }
  }

  if (error && !event) return <main className="page-shell"><Link href="/admin/events">← Event Registry</Link><div className="error-card">{error}</div></main>;
  if (!event) return <main className="page-shell">Loading event…</main>;

  const venue = one(event.venues);
  const city = one(event.cities);
  const editorial = one(event.event_editorial) || {};
  const sourceLinks = event.event_sources || [];
  const categories = (event.event_categories || []).map(item => one(item.categories)).filter(Boolean);
  const organizers = (event.event_organizers || []).map(item => ({ ...one(item.organizers), role: item.role })).filter(item => item.id);
  const tags = (event.event_tags || []).map(item => one(item.tags)).filter(Boolean);
  const sourceNames = [...new Set(sourceLinks.map(item => one(item.sources)?.name).filter(Boolean))];
  const firstDiscoveredAt = sourceLinks.reduce((earliest, item) => !earliest || new Date(item.discovered_at) < new Date(earliest) ? item.discovered_at : earliest, null);

  return (
    <main className="page-shell">
      <div className="detail-breadcrumbs"><Link href="/admin/events">← Event Registry</Link><Link href="/admin/sources">Source Registry</Link><Link href="/admin/review">Morning Review</Link><Link href="/admin/publishing">Publishing Desk</Link></div>
      <header className="detail-header event-detail-header">
        <div>
          <div className="brand-mark">HEY NOW</div>
          <h1>{event.title}</h1>
          <p className="event-lede">{fmtDate(event.start_at)} · {venue?.name || "Venue unassigned"}{venue?.locality ? ` · ${venue.locality}` : ""}</p>
          <div><StatePill value={event.status} />{categories.map(item => <span className="pill" key={item.id}>{item.name}</span>)}</div>
        </div>
        <div className="detail-links">{editorial.data_review_state === "approved" ? <button disabled={Boolean(busy)} onClick={openPublishingDraft}>{busy === "publishing" ? "Opening…" : "Create / open post"}</button> : null}{event.official_url ? <a className="button secondary" href={event.official_url} target="_blank" rel="noreferrer">Official page ↗</a> : null}{event.ticket_url ? <a className="button" href={event.ticket_url} target="_blank" rel="noreferrer">Tickets ↗</a> : null}</div>
      </header>

      {error ? <div className="error-card">{error}</div> : null}
      {message ? <div className="success-card">{message}</div> : null}

      <section className="review-workbench card">
        <div className="review-heading"><div><h2>Editorial workflow</h2><p className="muted">Each decision is retained in the review history. Flags never delete the event.</p></div><div className="source-count"><strong>{sourceNames.length}</strong><span>source{sourceNames.length === 1 ? "" : "s"}</span></div></div>
        <label className="notes-field"><span>Notes for the next action</span><textarea value={notes} onChange={item => setNotes(item.target.value)} placeholder="What did you verify, reject, or flag?" rows="3" /></label>
        <div className="review-stage-grid">{REVIEW_STAGES.map(stage => (
          <div className="review-stage" key={stage.column}>
            <div><strong>{stage.label}</strong><div className="sub">{stage.help}</div></div>
            <StatePill value={editorial[stage.column]} />
            <div className="review-actions">{["pending", "approved", "rejected"].map(decision => <button disabled={Boolean(busy)} className={`action-button ${decision}`} onClick={() => review(stage.column, decision)} key={decision}>{busy === `${stage.column}:${decision}` ? "Saving…" : decision.replace("_", " ")}</button>)}</div>
          </div>
        ))}</div>
        <div className="flag-actions"><span>Data quality flags</span><button disabled={Boolean(busy)} className="action-button flagged" onClick={() => review("data_review_state", "needs_review", "duplicate")}>Flag duplicate</button><button disabled={Boolean(busy)} className="action-button flagged" onClick={() => review("data_review_state", "needs_review", "wrong_geography")}>Flag wrong geography</button><button disabled={Boolean(busy)} className="action-button flagged" onClick={() => review("data_review_state", "needs_review", "needs_review")}>Needs review</button></div>
      </section>

      <section className="card-grid event-facts-grid">
        <div className="card"><h2>Canonical facts</h2><Field label="Starts">{fmtDate(event.start_at)}{event.is_all_day ? " · all day" : ""}</Field><Field label="Ends">{fmtDate(event.end_at)}</Field><Field label="Doors">{fmtDate(event.doors_at)}</Field><Field label="Timezone">{event.timezone}</Field><Field label="Status">{event.status}</Field><Field label="Price">{event.is_free ? "Free" : fmtMoney(event.price_min_cents, event.price_max_cents, event.currency)}</Field><Field label="Age">{event.is_all_ages ? "All ages" : event.age_min != null ? `${event.age_min}+` : "—"}</Field><Field label="First seen">{fmtDate(event.first_seen_at)}</Field><Field label="Last verified">{fmtDate(event.last_verified_at)}</Field><Field label="Canonical ID"><code>{event.id}</code></Field></div>
        <div className="card"><h2>Venue & geography</h2><Field label="Venue">{venue?.name}</Field><Field label="Address">{[venue?.address_line_1, venue?.address_line_2].filter(Boolean).join(", ") || "—"}</Field><Field label="Locality">{venue?.locality}</Field><Field label="Region">{venue?.region}</Field><Field label="Postal code">{venue?.postal_code}</Field><Field label="City record">{city ? `${city.name}${city.state_region ? `, ${city.state_region}` : ""} · ${city.country_code}` : "—"}</Field><Field label="Coordinates">{venue?.latitude != null && venue?.longitude != null ? `${venue.latitude}, ${venue.longitude}` : "—"}</Field>{venue?.website_url ? <Field label="Venue URL"><a href={venue.website_url} target="_blank" rel="noreferrer">Open venue site ↗</a></Field> : null}</div>
      </section>

      <section className="card">
        <div className="section-heading"><div><h2>Proposed fact changes</h2><p className="muted">Approved facts stay unchanged until a proposal is accepted here.</p></div><span className="pill warn">{proposals.filter(item => item.status === "pending").length} pending</span></div>
        {proposals.length ? proposals.map(proposal => <article className="proposal-row" key={proposal.id}>
          <div className="section-heading"><div><strong>{proposal.field_name.replaceAll("_", " ")}</strong><div className="sub">Detected {fmtDate(proposal.created_at)}{proposal.event_sources?.sources?.name ? ` · ${proposal.event_sources.sources.name}` : ""}</div></div><StatePill value={proposal.status === "accepted" ? "approved" : proposal.status} /></div>
          <div className="proposal-values"><div><span>Current approved value</span><pre>{valueText(proposal.old_value)}</pre></div><div><span>Proposed source value</span><pre>{valueText(proposal.proposed_value)}</pre></div></div>
          {proposal.evidence_excerpt ? <details><summary>Source evidence</summary><p className="prose">{proposal.evidence_excerpt}</p>{proposal.event_sources?.source_url ? <a href={proposal.event_sources.source_url} target="_blank" rel="noreferrer">Open source ↗</a> : null}</details> : null}
          {proposal.status === "pending" ? <div><button disabled={Boolean(busy)} onClick={() => reviewProposal(proposal.id, "accepted")}>Accept and apply</button> <button disabled={Boolean(busy)} onClick={() => reviewProposal(proposal.id, "rejected")}>Reject</button></div> : null}
        </article>) : <p className="muted">No source has proposed a change to approved facts.</p>}
      </section>

      <section className="card"><h2>Description</h2><p className="prose">{event.factual_description || "No factual description was extracted."}</p>{event.event_url ? <a href={event.event_url} target="_blank" rel="noreferrer">Event URL ↗</a> : null}</section>

      <section className="card provenance-card">
        <div className="section-heading"><div><h2>Source provenance</h2><p className="muted">{sourceLinks.length} observation{sourceLinks.length === 1 ? "" : "s"} across {sourceNames.length} source{sourceNames.length === 1 ? "" : "s"}.</p></div>{sourceNames.length > 1 ? <span className="pill good">Cross-source match</span> : <span className="pill">Unique to one source</span>}</div>
        {sourceLinks.map(sourceLink => {
          const source = one(sourceLink.sources);
          const run = one(sourceLink.source_runs);
          return <article className="provenance-item" key={sourceLink.id}>
            <div className="provenance-title"><div><strong>{source?.name || "Unknown source"}</strong><div className="sub">{source?.source_type || "source"} · discovered {fmtDate(sourceLink.discovered_at)} · last seen {fmtDate(sourceLink.last_seen_at)}</div></div><div>{sourceLink.discovered_at === firstDiscoveredAt ? <span className="pill good">First source</span> : null}{source?.priority_tier ? <span className="pill strong">{source.priority_tier}</span> : null}{sourceLink.extraction_confidence != null ? <span className="pill">{Math.round(Number(sourceLink.extraction_confidence) * 100)}% confidence</span> : null}</div></div>
            <div className="source-links">{sourceLink.source_url ? <a href={sourceLink.source_url} target="_blank" rel="noreferrer">Open observation ↗</a> : null}{source?.url ? <a href={source.url} target="_blank" rel="noreferrer">Source home ↗</a> : null}</div>
            <div className="mini-fields"><span><b>External ID</b>{sourceLink.external_id || "—"}</span><span><b>Content hash</b>{sourceLink.content_hash || "—"}</span><span><b>Source run</b>{run ? `${run.status} · ${fmtDate(run.started_at)}` : "—"}</span></div>
            {sourceLink.raw_text ? <details><summary>Raw source text</summary><pre className="evidence">{sourceLink.raw_text}</pre></details> : null}
            {sourceLink.raw_payload ? <details><summary>Raw source payload</summary><pre className="evidence">{JSON.stringify(sourceLink.raw_payload, null, 2)}</pre></details> : null}
            {sourceLink.extracted_payload ? <details><summary>Extracted payload</summary><pre className="evidence">{JSON.stringify(sourceLink.extracted_payload, null, 2)}</pre></details> : null}
            {sourceLink.raw_asset_path ? <div className="sub">Raw asset: {sourceLink.raw_asset_path}</div> : null}
          </article>;
        })}
      </section>

      <section className="card-grid">
        <div className="card"><h2>Classification</h2><Field label="Categories">{categories.map(item => item.name).join(", ") || "—"}</Field><Field label="Tags">{tags.map(item => item.name).join(", ") || "—"}</Field><Field label="Organizers">{organizers.map(item => `${item.name}${item.role ? ` (${item.role})` : ""}`).join(", ") || "—"}</Field><Field label="Feature level">{editorial.feature_level}</Field><Field label="HeyNow take">{editorial.heynow_take}</Field><Field label="Editorial notes">{editorial.editorial_notes}</Field></div>
        <div className="card"><h2>Review history</h2>{reviews.length ? reviews.map(item => <div className="history-row" key={item.id}><div><strong>{item.review_stage.replaceAll("_", " ")} · {item.decision.replaceAll("_", " ")}</strong><span className="sub inline-sub">{fmtDate(item.created_at)}</span></div>{item.notes ? <p>{item.notes}</p> : <p className="muted">No note supplied.</p>}</div>) : <p className="muted">No editorial decisions recorded yet.</p>}</div>
      </section>
    </main>
  );
}
