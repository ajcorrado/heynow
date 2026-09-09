import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const RUBRIC_VERSION = "morning-v1", HORIZON_DAYS = 30, MAX_SOURCES = 10, MAX_SHORTLIST = 20, SOURCE_LIMIT = 120;
function json(body: unknown, status = 200) { return Response.json(body, { status, headers: { "cache-control": "no-store" } }); }
async function authorize(request: Request, service: any) {
  const authorization = request.headers.get("authorization") || "";
  const scheduledSecret = request.headers.get("x-heynow-sweep-secret"), expectedSecret = Deno.env.get("HEYNOW_SWEEP_SECRET");
  if (scheduledSecret && expectedSecret && scheduledSecret === expectedSecret) return { trigger: "scheduled", userId: null, authorization: "Bearer "+Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") };
  if (!authorization.toLowerCase().startsWith("bearer ")) throw new Error("unauthorized");
  const userClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: authorization } }, auth: { persistSession: false } });
  const { data: { user }, error } = await userClient.auth.getUser();
  if (error || !user) throw new Error("unauthorized");
  const { data: admin } = await service.from("admin_users").select("user_id").eq("user_id", user.id).maybeSingle();
  if (!admin) throw new Error("forbidden");
  return { trigger: "manual", userId: user.id, authorization };
}
function score(event: any) {
  const soon = (new Date(event.start_at).getTime() - Date.now()) / 86400000, local = event.venues?.locality?.toLowerCase() === "el paso" ? 2 : 1, complete = event.title && event.start_at && event.venues?.name;
  return { verification_state: complete ? "supported" : "incomplete", local_relevance: local, distinctiveness: 1, audience_fit: 1, timeliness: soon <= 7 ? 2 : 1, usefulness: complete ? 2 : 1, rationale: complete ? "Timely local event with source-backed title, occurrence, and venue." : "Potentially useful, but one or more material facts are missing." };
}
Deno.serve(async request => {
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const service = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  let auth; try { auth = await authorize(request, service); } catch (error) { return json({ error: error instanceof Error ? error.message : "unauthorized" }, 401); }
  const body = await request.json().catch(() => ({})), idempotencyKey = typeof body.idempotencyKey === "string" ? body.idempotencyKey : auth.trigger+":"+new Date().toISOString().slice(0,10);
  const { data: prior } = await service.from("sweep_runs").select("*").eq("idempotency_key", idempotencyKey).maybeSingle(); if (prior) return json({ run: prior, duplicateTrigger: true });
  const { data: city } = await service.from("cities").select("id").eq("slug", "el-paso").single();
  const { data: sourcePool, error: sourceError } = await service.from("sources").select("id,name,parser_key,adapter_status,requires_login,requires_browser,active,priority_tier,priority").eq("city_id", city.id).eq("active", true).in("priority_tier", ["P0","P1"]).order("priority", { ascending: false });
  const sources = (sourcePool || []).sort((a:any,b:any) => Number(b.adapter_status === "active") - Number(a.adapter_status === "active") || (b.priority || 0) - (a.priority || 0)).slice(0, MAX_SOURCES);
  if (sourceError || !sources?.length) return json({ error: "no_approved_sources" }, 409);
  const config = { market: "el-paso", horizon_days: HORIZON_DAYS, max_sources: MAX_SOURCES, max_shortlist: MAX_SHORTLIST, source_limit: SOURCE_LIMIT, model_budget_tokens: 0, estimated_cost_budget_usd: 0, schedule_enabled: false };
  const { data: run, error: createError } = await service.from("sweep_runs").insert({ city_id: city.id, trigger_type: auth.trigger, status: "running", idempotency_key: idempotencyKey, configuration: config, rubric_version: RUBRIC_VERSION, selected_source_ids: sources.map((s:any)=>s.id), started_by: auth.userId, started_at: new Date().toISOString(), lock_expires_at: new Date(Date.now()+15*60*1000).toISOString() }).select("*").single();
  if (createError) return json({ error: createError.code === "23505" ? "sweep_already_running" : createError.message }, 409);
  const exceptions:any[]=[]; let succeeded=0, failed=0, unsupported=0;
  for (const source of sources) {
    const supported = source.adapter_status === "active" && ["visit-el-paso","ktep"].includes(source.parser_key);
    const { data: item } = await service.from("sweep_run_sources").insert({ sweep_run_id: run.id, source_id: source.id, status: supported ? "running" : "unsupported", retrieval_status: supported ? "pending" : "unsupported", extraction_status: supported ? "pending" : "skipped", started_at: new Date().toISOString(), error_message: supported ? null : (source.requires_login ? "Requires authenticated/browser retrieval not supported in V1" : "No active adapter") }).select("id").single();
    if (!supported) { unsupported++; exceptions.push({ source: source.name, status: "unsupported", reason: source.requires_login ? "authenticated_or_browser_source" : "adapter_not_implemented" }); continue; }
    try {
      const response = await fetch(Deno.env.get("SUPABASE_URL")+"/functions/v1/heynow-ingest", { method: "POST", headers: { "content-type":"application/json", authorization: auth.authorization }, body: JSON.stringify({ sourceKey: source.parser_key, limit: SOURCE_LIMIT, horizonDays: HORIZON_DAYS }) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error || "HTTP "+response.status);
      await service.from("source_runs").update({ sweep_run_id: run.id }).eq("id", result.runId);
      await service.from("sweep_run_sources").update({ source_run_id: result.runId, status: result.status === "success" ? "succeeded" : "failed", retrieval_status: "succeeded", extraction_status: result.extracted ? "succeeded" : "no_events", events_found: result.extracted || 0, error_message: result.errors?.length ? JSON.stringify(result.errors.slice(0,5)) : null, finished_at: new Date().toISOString() }).eq("id", item.id);
      if (result.status === "success") succeeded++; else { failed++; exceptions.push({ source:source.name,status:result.status,reason:"ingestion_errors" }); }
    } catch (error) { failed++; const message=error instanceof Error?error.message:String(error); exceptions.push({source:source.name,status:"failed",reason:message}); await service.from("sweep_run_sources").update({ status:"failed", retrieval_status:"failed", extraction_status:"skipped", error_message:message, finished_at:new Date().toISOString() }).eq("id",item.id); }
  }
  const horizon = new Date(Date.now()+HORIZON_DAYS*86400000).toISOString();
  const { data: events } = await service.from("events").select("id,title,start_at,end_at,is_all_day,is_free,venue_id,venues(name,locality,region),event_editorial(data_review_state)").eq("city_id",city.id).gte("start_at",new Date().toISOString()).lt("start_at",horizon).order("start_at").limit(500);
  const eligible=(events||[]).filter((e:any)=>e.event_editorial?.data_review_state!=="rejected"), total=(a:any)=>a.local_relevance+a.distinctiveness+a.audience_fit+a.timeliness+a.usefulness;
  const ranked=eligible.map((event:any)=>({event,assessment:score(event)})).sort((a:any,b:any)=>total(b.assessment)-total(a.assessment)).slice(0,MAX_SHORTLIST);
  if(ranked.length) await service.from("sweep_candidates").upsert(ranked.map(({event,assessment}:any)=>({sweep_run_id:run.id,event_id:event.id,...assessment,rubric_version:RUBRIC_VERSION})),{onConflict:"sweep_run_id,event_id",ignoreDuplicates:true});
  const attempted=sources.length, finalStatus=failed===0&&unsupported===0?"succeeded":succeeded>0?"partial":"failed";
  const { data: completed } = await service.from("sweep_runs").update({status:finalStatus,sources_attempted:attempted,sources_succeeded:succeeded,sources_failed:failed,sources_unsupported:unsupported,candidates_found:eligible.length,error_details:exceptions,finished_at:new Date().toISOString(),lock_expires_at:null}).eq("id",run.id).select("*").single();
  return json({run:completed,shortlistCount:ranked.length,exceptions});
});
