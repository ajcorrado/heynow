import { scoreEventSignal } from "../_shared/event-signal.mjs";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const RUBRIC_VERSION = "signal-v1";
const HORIZON_DAYS = 30;
const MAX_SOURCES = 10;
const MAX_SHORTLIST = 20;
// Keep ingestion comfortably inside the parent Edge Function wall-clock budget.
// Live runs showed 120-event child batches completing in 111-117 seconds,
// after the former 105-second parent timeout had already labeled them failed.
const SOURCE_LIMIT = 100;
const SWEEP_LOCK_MS = 3 * 60 * 1000;
const SOURCE_TIMEOUT_MS = 120 * 1000;
const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, x-client-info, apikey, content-type, x-heynow-sweep-secret",
  "access-control-allow-methods": "POST, OPTIONS",
};

function namedKey(envName: string, legacyName: string) {
  const named = Deno.env.get(envName);
  if (named) {
    try {
      const keys = JSON.parse(named);
      if (keys.default) return keys.default;
    } catch {}
  }
  const legacy = Deno.env.get(legacyName);
  if (!legacy) throw new Error(`missing_${envName.toLowerCase()}`);
  return legacy;
}

const publicKey = () => namedKey("SUPABASE_PUBLISHABLE_KEYS", "SUPABASE_ANON_KEY");
const secretKey = () => namedKey("SUPABASE_SECRET_KEYS", "SUPABASE_SERVICE_ROLE_KEY");

function json(body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: { ...CORS_HEADERS, "cache-control": "no-store" },
  });
}

async function authorize(request: Request, service: any) {
  const authorization = request.headers.get("authorization") || "";
  const scheduledSecret = request.headers.get("x-heynow-sweep-secret");
  const expectedSecret = Deno.env.get("HEYNOW_SWEEP_SECRET");

  if (scheduledSecret && expectedSecret && scheduledSecret === expectedSecret) {
    return {
      trigger: "scheduled",
      userId: null,
      authorization: "Bearer " + Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"),
    };
  }

  if (!authorization.toLowerCase().startsWith("bearer ")) throw new Error("unauthorized");
  const userClient = createClient(Deno.env.get("SUPABASE_URL")!, publicKey(), {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false },
  });
  const { data: { user }, error } = await userClient.auth.getUser();
  if (error || !user) throw new Error("unauthorized");
  const { data: admin } = await userClient
    .from("admin_users")
    .select("user_id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!admin) throw new Error("forbidden");
  return { trigger: "manual", userId: user.id, authorization, client: userClient };
}

function score(event: any) {
  const soon = (new Date(event.start_at).getTime() - Date.now()) / 86400000;
  const local = event.venues?.locality?.toLowerCase() === "el paso" ? 2 : 1;
  const complete = event.title && event.start_at && event.venues?.name;
  return {
    verification_state: complete ? "supported" : "incomplete",
    local_relevance: local,
    distinctiveness: 1,
    audience_fit: 1,
    timeliness: soon <= 7 ? 2 : 1,
    usefulness: complete ? 2 : 1,
    rationale: complete
      ? "Timely local event with source-backed title, occurrence, and venue."
      : "Potentially useful, but one or more material facts are missing.",
  };
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const service = createClient(Deno.env.get("SUPABASE_URL")!, secretKey(), {
    auth: { persistSession: false },
  });

  let auth;
  try {
    auth = await authorize(request, service);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "unauthorized" }, 401);
  }

  const db = auth.client || service;
  const body = await request.json().catch(() => ({}));
  const idempotencyKey = typeof body.idempotencyKey === "string"
    ? body.idempotencyKey
    : auth.trigger + ":" + new Date().toISOString().slice(0, 10);

  const { data: prior } = await db
    .from("sweep_runs")
    .select("*")
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();
  if (prior) return json({ run: prior, duplicateTrigger: true });

  // Recover any prior invocation that the Edge Runtime killed before it could
  // write a terminal state. Preserve child evidence; only mark unfinished work.
  const recoveredAt = new Date().toISOString();
  const { data: staleRuns } = await service
    .from("sweep_runs")
    .select("id")
    .eq("status", "running")
    .lt("lock_expires_at", recoveredAt);
  const staleIds = (staleRuns || []).map((row: any) => row.id);
  if (staleIds.length) {
    await service
      .from("sweep_run_sources")
      .update({
        status: "failed",
        error_message: "Parent sweep expired before completion",
        finished_at: recoveredAt,
      })
      .in("sweep_run_id", staleIds)
      .eq("status", "running");
    await service
      .from("sweep_runs")
      .update({
        status: "failed",
        error_details: [{ reason: "stale_run_recovered_after_lock_expiry" }],
        finished_at: recoveredAt,
        lock_expires_at: null,
      })
      .in("id", staleIds);
  }

  const { data: city } = await db.from("cities").select("id").eq("slug", "el-paso").single();
  const { data: sourcePool, error: sourceError } = await db
    .from("sources")
    .select("id,name,parser_key,adapter_status,requires_login,requires_browser,active,priority_tier,priority")
    .eq("city_id", city.id)
    .eq("active", true)
    .in("priority_tier", ["P0", "P1"])
    .order("priority", { ascending: false });

  const sources = (sourcePool || [])
    .sort((a: any, b: any) =>
      Number(b.adapter_status === "active") - Number(a.adapter_status === "active") ||
      (b.priority || 0) - (a.priority || 0)
    )
    .slice(0, MAX_SOURCES);

  if (sourceError || !sources?.length) return json({ error: "no_approved_sources" }, 409);

  const config = {
    market: "el-paso",
    horizon_days: HORIZON_DAYS,
    max_sources: MAX_SOURCES,
    max_shortlist: MAX_SHORTLIST,
    source_limit: SOURCE_LIMIT,
    model_budget_tokens: 0,
    estimated_cost_budget_usd: 0,
    schedule_enabled: false,
    orchestration: "parallel-v1",
    source_timeout_ms: SOURCE_TIMEOUT_MS,
  };

  const { data: run, error: createError } = await db
    .from("sweep_runs")
    .insert({
      city_id: city.id,
      trigger_type: auth.trigger,
      status: "running",
      idempotency_key: idempotencyKey,
      configuration: config,
      rubric_version: RUBRIC_VERSION,
      selected_source_ids: sources.map((s: any) => s.id),
      started_by: auth.userId,
      started_at: new Date().toISOString(),
      lock_expires_at: new Date(Date.now() + SWEEP_LOCK_MS).toISOString(),
    })
    .select("*")
    .single();

  if (createError) {
    return json({ error: createError.code === "23505" ? "sweep_already_running" : createError.message }, 409);
  }

  const sourceResults = await Promise.all(sources.map(async (source: any) => {
    const supported = source.adapter_status === "active" && [
      "visit-el-paso",
      "ktep",
      "el-paso-live",
      "love-buzz",
      "lowbrow-palace",
      "the-falstaff",
      "verso",
    ].includes(source.parser_key);

    const { data: item } = await db
      .from("sweep_run_sources")
      .insert({
        sweep_run_id: run.id,
        source_id: source.id,
        status: supported ? "running" : "unsupported",
        retrieval_status: supported ? "pending" : "unsupported",
        extraction_status: supported ? "pending" : "skipped",
        started_at: new Date().toISOString(),
        error_message: supported
          ? null
          : source.requires_login
          ? "Requires authenticated/browser retrieval not supported in V1"
          : "No active adapter",
      })
      .select("id")
      .single();

    if (!supported) {
      return {
        outcome: "unsupported",
        exception: {
          source: source.name,
          status: "unsupported",
          reason: source.requires_login ? "authenticated_or_browser_source" : "adapter_not_implemented",
        },
      };
    }

    try {
      const response = await fetch(
        Deno.env.get("SUPABASE_URL") + "/functions/v1/heynow-ingest",
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: auth.authorization,
          },
          body: JSON.stringify({
            sourceKey: source.parser_key,
            limit: SOURCE_LIMIT,
            horizonDays: HORIZON_DAYS,
            sweepRunId: run.id,
          }),
          signal: AbortSignal.timeout(SOURCE_TIMEOUT_MS),
        },
      );
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "HTTP " + response.status);

      await db.from("source_runs").update({ sweep_run_id: run.id }).eq("id", result.runId);
      await db
        .from("sweep_run_sources")
        .update({
          source_run_id: result.runId,
          status: result.status === "success" ? "succeeded" : "failed",
          retrieval_status: "succeeded",
          extraction_status: result.extracted ? "succeeded" : "no_events",
          events_found: result.extracted || 0,
          error_message: result.errors?.length ? JSON.stringify(result.errors.slice(0, 5)) : null,
          finished_at: new Date().toISOString(),
        })
        .eq("id", item.id);

      if (result.status === "success") return { outcome: "succeeded", exception: null };
      return {
        outcome: "failed",
        exception: { source: source.name, status: result.status, reason: "ingestion_errors" },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await db
        .from("sweep_run_sources")
        .update({
          status: "failed",
          retrieval_status: "failed",
          extraction_status: "skipped",
          error_message: message,
          finished_at: new Date().toISOString(),
        })
        .eq("id", item.id);
      return {
        outcome: "failed",
        exception: { source: source.name, status: "failed", reason: message },
      };
    }
  }));

  const succeeded = sourceResults.filter((result: any) => result.outcome === "succeeded").length;
  const failed = sourceResults.filter((result: any) => result.outcome === "failed").length;
  const unsupported = sourceResults.filter((result: any) => result.outcome === "unsupported").length;
  const exceptions = sourceResults.map((result: any) => result.exception).filter(Boolean);

  const horizon = new Date(Date.now() + HORIZON_DAYS * 86400000).toISOString();
  const { count: proposedChanges } = await db
    .from("event_change_proposals")
    .select("id", { count: "exact", head: true })
    .eq("sweep_run_id", run.id);
  const { data: events } = await db
    .from("events")
    .select("id,title,factual_description,start_at,end_at,is_all_day,is_free,hero_image_url,venue_id,venues(name,locality,region),event_editorial(data_review_state),event_sources(sources(source_roles,uniqueness_score))")
    .eq("city_id", city.id)
    .gte("start_at", new Date().toISOString())
    .lt("start_at", horizon)
    .order("start_at")
    .limit(500);

  const eligible = (events || []).filter((event: any) => event.event_editorial?.data_review_state !== "rejected");
  const ranked = eligible
    .map((event: any) => ({ event, assessment: scoreEventSignal(event) }))
    .sort((a: any, b: any) => b.assessment.total_score - a.assessment.total_score)
    .slice(0, MAX_SHORTLIST);

  if (ranked.length) {
    await db.from("sweep_candidates").upsert(
      ranked.map(({ event, assessment }: any) => {
        const { total_score: _computedTotal, ...storedAssessment } = assessment;
        return {
          sweep_run_id: run.id,
          event_id: event.id,
          ...storedAssessment,
          rubric_version: RUBRIC_VERSION,
        };
      }),
      { onConflict: "sweep_run_id,event_id", ignoreDuplicates: true },
    );
  }

  const attempted = sources.length;
  const finalStatus = failed === 0 && unsupported === 0
    ? "succeeded"
    : succeeded > 0
    ? "partial"
    : "failed";

  const { data: completed } = await db
    .from("sweep_runs")
    .update({
      status: finalStatus,
      sources_attempted: attempted,
      sources_succeeded: succeeded,
      sources_failed: failed,
      sources_unsupported: unsupported,
      candidates_found: eligible.length,
      proposed_changes: proposedChanges ?? 0,
      error_details: exceptions,
      finished_at: new Date().toISOString(),
      lock_expires_at: null,
    })
    .eq("id", run.id)
    .select("*")
    .single();

  return json({ run: completed, shortlistCount: ranked.length, exceptions });
});
