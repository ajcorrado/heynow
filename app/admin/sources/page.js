"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "../../../lib/supabase";

const PRIORITY = { P0:0, P1:1, P2:2, P3:3, manual_only:4, deprioritized:5 };
const pct = v => v == null ? "—" : Math.round(Number(v) * 100) + "%";
const fmtDate = v => !v ? "—" : new Date(v).toLocaleString();
function Pill({ children, tone="" }) { return <span className={"pill " + tone}>{children}</span>; }

export default function SourcesPage() {
  const router = useRouter();
  const [rows,setRows] = useState([]);
  const [error,setError] = useState("");
  const [loading,setLoading] = useState(true);
  const [q,setQ] = useState("");
  const [priority,setPriority] = useState("");
  const [role,setRole] = useState("");
  const [method,setMethod] = useState("");
  const [adapter,setAdapter] = useState("");
  const [health,setHealth] = useState("");
  const [sort,setSort] = useState("priority");

  useEffect(() => {
    (async () => {
      const { data: sessionData } = await supabase.auth.getSession();
      if (!sessionData.session) { router.replace("/login"); return; }
      const { data, error } = await supabase.from("source_registry").select("*");
      if (error) setError(error.message); else setRows(data || []);
      setLoading(false);
    })();
  }, [router]);

  const filtered = useMemo(() => {
    const out = rows.filter(r => {
      const hay = [r.name,r.source_type,r.owner_entity,...(r.source_roles||[]),...(r.content_categories||[])].join(" ").toLowerCase();
      if (q && !hay.includes(q.toLowerCase())) return false;
      if (priority && r.priority_tier !== priority) return false;
      if (role && !(r.source_roles || []).includes(role)) return false;
      if (method && r.ingestion_method !== method) return false;
      if (adapter && r.adapter_status !== adapter) return false;
      if (health && r.health !== health) return false;
      return true;
    });
    out.sort((a,b) => {
      if (sort === "value") return (Number(b.adjusted_source_value)||-1) - (Number(a.adjusted_source_value)||-1);
      if (sort === "unique") return Number(b.events_unique_30d||0) - Number(a.events_unique_30d||0);
      if (sort === "volume") return Number(b.events_seen_30d||0) - Number(a.events_seen_30d||0);
      if (sort === "last_ingest") return new Date(b.last_successful_ingest_at||0) - new Date(a.last_successful_ingest_at||0);
      return (PRIORITY[a.priority_tier]??99) - (PRIORITY[b.priority_tier]??99) || a.name.localeCompare(b.name);
    });
    return out;
  }, [rows,q,priority,role,method,adapter,health,sort]);

  const vals = key => [...new Set(rows.flatMap(r => Array.isArray(r[key]) ? r[key] : (r[key] ? [r[key]] : [])))].sort();
  async function logout() { await supabase.auth.signOut(); router.replace("/login"); }

  if (loading) return <main className="page-shell">Loading registry…</main>;

  return (
    <main className="page-shell">
      <header className="topbar">
        <div>
          <div className="brand-mark">HEY NOW</div>
          <h1>Source Registry</h1>
          <p className="muted">{rows.length} known sources · {rows.filter(r=>r.priority_tier==="P0").length} P0 · {rows.filter(r=>r.adapter_status==="active").length} active adapter</p>
          <nav className="admin-nav"><Link href="/admin/events">Events</Link><Link className="active" href="/admin/sources">Sources</Link><Link href="/admin/review">Morning Review</Link></nav>
        </div>
        <button className="button secondary" onClick={logout}>Sign out</button>
      </header>

      {error ? <div className="error-card"><strong>Registry access failed.</strong><br />{error}<br /><span className="muted">This login may not yet be in admin_users.</span></div> : null}

      <section className="filters">
        <input placeholder="Search sources, categories, roles…" value={q} onChange={e=>setQ(e.target.value)} />
        <select value={priority} onChange={e=>setPriority(e.target.value)}><option value="">All priorities</option>{["P0","P1","P2","P3","manual_only","deprioritized"].map(v=><option key={v}>{v}</option>)}</select>
        <select value={role} onChange={e=>setRole(e.target.value)}><option value="">All roles</option>{vals("source_roles").map(v=><option key={v}>{v}</option>)}</select>
        <select value={method} onChange={e=>setMethod(e.target.value)}><option value="">All methods</option>{vals("ingestion_method").map(v=><option key={v}>{v}</option>)}</select>
        <select value={adapter} onChange={e=>setAdapter(e.target.value)}><option value="">All adapters</option>{vals("adapter_status").map(v=><option key={v}>{v}</option>)}</select>
        <select value={health} onChange={e=>setHealth(e.target.value)}><option value="">All health</option>{vals("health").map(v=><option key={v}>{v}</option>)}</select>
        <select value={sort} onChange={e=>setSort(e.target.value)}>
          <option value="priority">Sort: priority</option>
          <option value="value">Sort: adjusted value</option>
          <option value="unique">Sort: unique events</option>
          <option value="volume">Sort: event volume</option>
          <option value="last_ingest">Sort: last ingest</option>
        </select>
      </section>

      <div className="table-wrap"><table>
        <thead><tr><th>Name</th><th>Priority</th><th>Role</th><th>Category</th><th>Unique Yield</th><th>Events / 30d</th><th>Quality</th><th>Difficulty</th><th>Adapter</th><th>Last Successful Ingest</th><th>Health</th></tr></thead>
        <tbody>{filtered.map(r => (
          <tr key={r.source_id} onClick={()=>router.push("/admin/sources/"+r.source_id)}>
            <td><strong>{r.name}</strong><div className="sub">{r.source_type}</div></td>
            <td><Pill tone={r.priority_tier==="P0"?"strong":""}>{r.priority_tier}</Pill></td>
            <td>{(r.source_roles||[]).slice(0,3).map(v=><Pill key={v}>{v}</Pill>)}</td>
            <td>{(r.content_categories||[]).slice(0,3).join(", ")||"—"}</td>
            <td>{pct(r.unique_yield_rate_30d ?? r.ingestion_unique_yield_rate_30d)}</td>
            <td>{r.events_seen_30d??0}</td>
            <td>{r.adjusted_source_value??"—"}</td>
            <td>{r.automation_difficulty||"—"}</td>
            <td><Pill>{r.adapter_status}</Pill></td>
            <td>{fmtDate(r.last_successful_ingest_at)}</td>
            <td><Pill tone={r.health==="healthy"?"good":(r.health==="stale"||r.health==="degraded")?"warn":""}>{r.health||"—"}</Pill></td>
          </tr>
        ))}</tbody>
      </table></div>
    </main>
  );
}
