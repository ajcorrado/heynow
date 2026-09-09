"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "../../../../lib/supabase";

const fmtDate = v => !v ? "—" : new Date(v).toLocaleString();
function Field({ label, children }) { return <div className="field"><div className="field-label">{label}</div><div>{children ?? "—"}</div></div>; }

export default function SourceDetail() {
  const { id } = useParams();
  const router = useRouter();
  const [source,setSource] = useState(null);
  const [recent,setRecent] = useState([]);
  const [history,setHistory] = useState([]);
  const [rels,setRels] = useState([]);
  const [error,setError] = useState("");

  useEffect(() => {
    (async () => {
      const { data: sessionData } = await supabase.auth.getSession();
      if (!sessionData.session) { router.replace("/login"); return; }

      const { data:s, error:se } = await supabase.from("source_registry").select("*").eq("source_id",id).maybeSingle();
      if (se) { setError(se.message); return; }
      setSource(s);

      const { data:obs } = await supabase.from("event_sources").select("event_id,source_url,last_seen_at").eq("source_id",id).order("last_seen_at",{ascending:false}).limit(20);
      const ids = [...new Set((obs||[]).map(o=>o.event_id).filter(Boolean))];
      let eventMap = {};
      if (ids.length) {
        const { data:events } = await supabase.from("events").select("id,title,start_at,status,venues(name,locality,region)").in("id",ids);
        eventMap = Object.fromEntries((events||[]).map(e=>[e.id,e]));
      }
      setRecent((obs||[]).map(o=>({...o,event:eventMap[o.event_id]})).filter(x=>x.event));

      const { data:h } = await supabase.from("source_priority_history").select("*").eq("source_id",id).order("reviewed_at",{ascending:false}).limit(20);
      setHistory(h||[]);

      const { data:rr } = await supabase.from("source_relationships").select("*").or("source_id.eq."+id+",related_source_id.eq."+id);
      const otherIds=[...new Set((rr||[]).map(x=>x.source_id===id?x.related_source_id:x.source_id))];
      let names={};
      if(otherIds.length){
        const {data:o}=await supabase.from("source_registry").select("source_id,name").in("source_id",otherIds);
        names=Object.fromEntries((o||[]).map(x=>[x.source_id,x.name]));
      }
      setRels((rr||[]).map(x=>({...x,otherName:names[x.source_id===id?x.related_source_id:x.source_id]||"Unknown"})));
    })();
  }, [id,router]);

  if (error) return <main className="page-shell"><Link href="/admin/sources">← Registry</Link><div className="error-card">{error}</div></main>;
  if (!source) return <main className="page-shell">Loading source…</main>;

  const uniqueYield = source.unique_yield_rate_30d ?? source.ingestion_unique_yield_rate_30d;

  return (
    <main className="page-shell">
      <div className="detail-breadcrumbs"><Link href="/admin/sources">← Source Registry</Link><Link href="/admin/events">Event Registry</Link><Link href="/admin/review">Morning Review</Link></div>
      <header className="detail-header">
        <div><div className="brand-mark">HEY NOW</div><h1>{source.name}</h1><p className="muted">{source.priority_tier} · {(source.source_roles||[]).join(" + ")} · {source.health}</p></div>
        {source.canonical_url ? <a className="button secondary" href={source.canonical_url} target="_blank" rel="noreferrer">Open source</a> : null}
      </header>

      <section className="card-grid">
        <div className="card"><h2>Identity</h2><Field label="Type">{source.source_type}</Field><Field label="Canonical URL">{source.canonical_url}</Field><Field label="Owner">{source.owner_entity}</Field><Field label="Geography"><pre>{JSON.stringify(source.geography||{},null,2)}</pre></Field><Field label="Categories">{(source.content_categories||[]).join(", ")}</Field></div>
        <div className="card"><h2>Strategic assessment</h2><Field label="Role">{(source.source_roles||[]).join(", ")}</Field><Field label="Priority">{source.priority_tier}</Field><Field label="Adjusted value">{source.adjusted_source_value}</Field><Field label="Scores">Coverage {source.coverage_score??"—"} · Quality {source.content_quality_score??"—"} · Unique {source.uniqueness_score??"—"} · Authority {source.authority_score??"—"} · Fresh {source.freshness_score??"—"} · Geo {source.geo_precision_score??"—"} · Complete {source.data_completeness_score??"—"}</Field><Field label="Notes">{source.notes}</Field></div>
        <div className="card"><h2>Technical profile</h2><Field label="Ingestion method">{source.ingestion_method}</Field><Field label="Difficulty">{source.automation_difficulty}</Field><Field label="Adapter">{source.adapter_status}</Field><Field label="Parser">{source.parser_type||source.parser_key}</Field><Field label="Browser / login / JS">{String(source.requires_browser)} / {String(source.requires_login)} / {String(source.javascript_required)}</Field><Field label="Breakage risk">{source.expected_breakage_risk}</Field></div>
        <div className="card"><h2>Performance</h2><Field label="Events seen / 30d">{source.events_seen_30d}</Field><Field label="Accepted / 30d">{source.events_accepted_30d}</Field><Field label="Rejected / 30d">{source.events_rejected_30d}</Field><Field label="Unique yield">{uniqueYield==null?"—":Math.round(Number(uniqueYield)*100)+"%"}</Field><Field label="Duplicate rate">{source.duplicate_rate_30d==null?"—":Math.round(Number(source.duplicate_rate_30d)*100)+"%"}</Field><Field label="Failures / 30d">{source.failure_count_30d}</Field><Field label="Last successful ingest">{fmtDate(source.last_successful_ingest_at)}</Field><Field label="Health">{source.health}</Field></div>
      </section>

      <section className="card"><h2>Recent events</h2>{recent.length ? recent.map((r,i)=><div className="event-row" key={r.event_id+"-"+i}><div><Link href={`/admin/events/${r.event_id}`}><strong>{r.event.title}</strong></Link><div className="sub">{fmtDate(r.event.start_at)} · {r.event.venues?.name||"No venue"}{r.event.venues?.locality?" · "+r.event.venues.locality:""}</div></div>{r.source_url?<a href={r.source_url} target="_blank" rel="noreferrer">Source ↗</a>:null}</div>) : <p className="muted">No ingested events yet.</p>}</section>

      <section className="card-grid">
        <div className="card"><h2>Relationships</h2>{rels.length ? rels.map(r=><div className="history-row" key={r.id}><strong>{r.relation_type}</strong> · {r.otherName}<div className="sub">{r.notes}</div></div>) : <p className="muted">No recorded relationships.</p>}</div>
        <div className="card"><h2>Priority history</h2>{history.length ? history.map(h=><div className="history-row" key={h.id}><strong>{h.previous_priority_tier||"—"} → {h.current_priority_tier}</strong><div className="sub">{fmtDate(h.reviewed_at)} · {h.reviewed_by||"unknown"}</div><div>{h.priority_change_reason||h.review_reason}</div></div>) : <p className="muted">No priority changes recorded yet.</p>}</div>
      </section>
    </main>
  );
}
