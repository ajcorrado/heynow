"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "../../../lib/supabase";

const fmt = (value) => value
  ? new Date(value).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })
  : "Unknown";
const valueText = (value) => value && typeof value === "object"
  ? JSON.stringify(value, null, 2)
  : value == null
  ? "—"
  : String(value);
const isLiveRun = (run) => run?.status === "running" && (!run.lock_expires_at || new Date(run.lock_expires_at).getTime() > Date.now());
const isStalledRun = (run) => run?.status === "running" && Boolean(run.lock_expires_at) && new Date(run.lock_expires_at).getTime() <= Date.now();

function Pill({ children, tone = "" }) {
  return <span className={"pill " + tone}>{children}</span>;
}

export default function MorningReview() {
  const router = useRouter();
  const [run, setRun] = useState(null);
  const [candidates, setCandidates] = useState([]);
  const [coverage, setCoverage] = useState([]);
  const [changes, setChanges] = useState([]);
  const [duplicates, setDuplicates] = useState([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function load() {
    const { data: sessionData } = await supabase.auth.getSession();
    if (!sessionData.session) {
      router.replace("/login");
      return;
    }

    const { data: r } = await supabase
      .from("sweep_runs")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    setRun(r);
    if (!r) {
      setCandidates([]);
      return;
    }

    const [{ data: c }, { data: s }, { data: p }, { data: d }] = await Promise.all([
      supabase
        .from("sweep_candidates")
        .select("*,events(*,venues(name,locality,region),event_sources(source_url,raw_text,last_seen_at))")
        .eq("sweep_run_id", r.id)
        .order("total_score", { ascending: false }),
      supabase.from("sweep_run_sources").select("*,sources(name)").eq("sweep_run_id", r.id),
      supabase
        .from("event_change_proposals")
        .select("*,events(title),event_sources(source_url,sources(name))")
        .eq("sweep_run_id", r.id)
        .order("created_at", { ascending: false }),
      supabase.from("duplicate_suggestions").select("*").eq("sweep_run_id", r.id),
    ]);

    setCandidates(c || []);
    setCoverage(s || []);
    setChanges(p || []);
    setDuplicates(d || []);
  }

  useEffect(() => {
    load();
  }, []);

  async function runSweep() {
    setBusy(true);
    setMessage("");
    const key = "manual:" + new Date().toISOString() + ":" + crypto.randomUUID();
    const { data, error } = await supabase.functions.invoke("heynow-sweep", {
      body: { idempotencyKey: key },
    });
    setBusy(false);

    if (error) {
      let detail = error.message;
      if (error.context instanceof Response) {
        try {
          const response = await error.context.clone().json();
          detail = response.error || response.message || detail;
        } catch {}
      }
      setMessage("Sweep failed: " + detail);
    } else {
      setMessage("Run " + data.run.status + ": " + data.shortlistCount + " shortlisted");
    }
    await load();
  }

  async function decide(candidate, state) {
    const reason = state === "rejected" ? window.prompt("Optional rejection reason") || null : null;
    const { data: { user } } = await supabase.auth.getUser();
    await supabase
      .from("sweep_candidates")
      .update({
        review_state: state,
        reviewed_by: user.id,
        reviewed_at: new Date().toISOString(),
        rejection_reason: reason,
      })
      .eq("id", candidate.id);
    await supabase
      .from("event_editorial")
      .update({ data_review_state: state === "deferred" ? "needs_review" : state, updated_at: new Date().toISOString() })
      .eq("event_id", candidate.event_id);
    await supabase.from("editorial_reviews").insert({
      event_id: candidate.event_id,
      reviewer_id: user.id,
      review_stage: "data",
      decision: state,
      notes: reason,
    });
    await load();
  }

  async function proposal(id, status) {
    const note = window.prompt("Optional review note") || null;
    setBusy(true);
    setMessage("");
    const { error } = await supabase.rpc("review_event_change_proposal", {
      proposal_id: id,
      review_decision: status,
      review_notes: note,
    });
    setBusy(false);
    setMessage(error ? "Proposal failed: " + error.message : `Change ${status}.`);
    await load();
  }

  const stalled = isStalledRun(run);
  const displayStatus = stalled ? "stalled" : run?.status;

  return (
    <main className="page-shell">
      <header className="topbar">
        <div>
          <div className="brand-mark">HEY NOW</div>
          <h1>Morning Review</h1>
          <p className="muted">Evidence-backed candidates only. Approval does not publish.</p>
        </div>
        <div>
          <Link className="button secondary" href="/admin/sources">Sources</Link>{" "}
          <Link className="button secondary" href="/admin/publishing">Publishing</Link>{" "}
          <button className="button" disabled={busy || isLiveRun(run)} onClick={runSweep}>
            {busy ? "Running…" : stalled ? "Retry sweep" : "Run sweep"}
          </button>
        </div>
      </header>

      {stalled ? (
        <div className="card">
          Previous sweep stopped before completion. Its lock expired, so it is safe to retry.
        </div>
      ) : null}
      {message ? <div className="card">{message}</div> : null}

      <section className="card">
        <h2>Run summary</h2>
        {run ? (
          <p>
            <b>{displayStatus}</b> · {run.sources_succeeded}/{run.sources_attempted} sources succeeded · {run.candidates_found} valid candidates · ${Number(run.estimated_cost_usd).toFixed(2)} variable cost
          </p>
        ) : <p>No sweep has run yet.</p>}
      </section>

      <section className="card">
        <h2>Coverage & exceptions</h2>
        {coverage.map((x) => (
          <div className="event-row" key={x.id}>
            <div>
              <strong>{x.sources?.name}</strong>
              <div className="sub">Retrieval: {x.retrieval_status} · Extraction: {x.extraction_status} · {x.events_found} events</div>
              {x.error_message ? <div className="sub">{x.error_message}</div> : null}
            </div>
            <Pill tone={x.status === "succeeded" ? "good" : x.status === "unsupported" ? "warn" : ""}>{x.status}</Pill>
          </div>
        ))}
      </section>

      <section className="card">
        <h2>Candidates <span className="muted">({candidates.length} shortlisted)</span></h2>
        {candidates.map((c) => {
          const e = c.events;
          const evidence = e.event_sources?.[0];
          return (
            <article className="event-row" key={c.id}>
              <div>
                <h3>{e.title}</h3>
                <p>{fmt(e.start_at)} · {e.venues?.name || "Venue unknown"} · {e.is_free === true ? "Free" : e.is_free === false ? "Paid" : "Price unknown"}</p>
                <p>{c.rationale}</p>
                <Pill tone={c.verification_state === "supported" ? "good" : "warn"}>{c.verification_state}</Pill>
                <Pill>{c.review_state}</Pill>
                {evidence ? (
                  <p>
                    <a href={evidence.source_url} target="_blank" rel="noreferrer">View source evidence ↗</a><br />
                    <span className="sub">{(evidence.raw_text || "").slice(0, 240)}</span>
                  </p>
                ) : <p className="muted">No linked evidence.</p>}
                <div>
                  <button onClick={() => decide(c, "approved")}>Approve</button>{" "}
                  <button onClick={() => decide(c, "rejected")}>Reject</button>{" "}
                  <button onClick={() => decide(c, "deferred")}>Defer</button>
                </div>
              </div>
              <strong>{c.total_score}/10</strong>
            </article>
          );
        })}
      </section>

      <section className="card">
        <h2>Changes</h2>
        {changes.length ? changes.map((p) => (
          <div className="proposal-row" key={p.id}>
            <div className="section-heading">
              <div>
                <strong><Link href={`/admin/events/${p.event_id}`}>{p.events?.title}</Link>: {p.field_name.replaceAll("_", " ")}</strong>
                <div className="sub">Detected {fmt(p.created_at)}{p.event_sources?.sources?.name ? ` · ${p.event_sources.sources.name}` : ""}</div>
              </div>
              <Pill tone={p.status === "accepted" ? "good" : p.status === "rejected" ? "bad" : "warn"}>{p.status}</Pill>
            </div>
            <div className="proposal-values">
              <div><span>Current approved value</span><pre>{valueText(p.old_value)}</pre></div>
              <div><span>Proposed source value</span><pre>{valueText(p.proposed_value)}</pre></div>
            </div>
            {p.evidence_excerpt ? (
              <details>
                <summary>Source evidence</summary>
                <p className="prose">{p.evidence_excerpt}</p>
                {p.event_sources?.source_url ? <a href={p.event_sources.source_url} target="_blank" rel="noreferrer">Open source ↗</a> : null}
              </details>
            ) : null}
            {p.status === "pending" ? (
              <div>
                <button disabled={busy} onClick={() => proposal(p.id, "accepted")}>Accept and apply</button>{" "}
                <button disabled={busy} onClick={() => proposal(p.id, "rejected")}>Reject</button>
              </div>
            ) : null}
          </div>
        )) : <p className="muted">No proposed changes.</p>}
      </section>

      <section className="card">
        <h2>Duplicates</h2>
        {duplicates.length ? <p>{duplicates.length} suggestions awaiting review.</p> : <p className="muted">No duplicate suggestions.</p>}
      </section>
    </main>
  );
}
