-- Morning Editorial Sweep V1: persistent orchestration and audited review queues.
create table public.sweep_runs (
  id uuid primary key default gen_random_uuid(),
  city_id uuid not null references public.cities(id),
  trigger_type text not null check (trigger_type in ('manual','scheduled')),
  status text not null default 'queued' check (status in ('queued','running','succeeded','partial','failed','cancelled')),
  idempotency_key text not null unique,
  configuration jsonb not null default '{}'::jsonb,
  rubric_version text not null,
  selected_source_ids uuid[] not null,
  sources_attempted integer not null default 0,
  sources_succeeded integer not null default 0,
  sources_failed integer not null default 0,
  sources_unsupported integer not null default 0,
  candidates_found integer not null default 0,
  proposed_changes integer not null default 0,
  duplicate_suggestions integer not null default 0,
  model_input_tokens integer not null default 0,
  model_output_tokens integer not null default 0,
  estimated_cost_usd numeric(12,6) not null default 0,
  error_details jsonb not null default '[]'::jsonb,
  started_by uuid references auth.users(id),
  started_at timestamptz,
  finished_at timestamptz,
  lock_expires_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index sweep_runs_one_active_per_city on public.sweep_runs(city_id) where status in ('queued','running');
create index sweep_runs_recent_idx on public.sweep_runs(created_at desc);
create table public.sweep_run_sources (
  id uuid primary key default gen_random_uuid(),
  sweep_run_id uuid not null references public.sweep_runs(id) on delete cascade,
  source_id uuid not null references public.sources(id),
  source_run_id uuid references public.source_runs(id),
  status text not null default 'queued' check (status in ('queued','running','succeeded','failed','unsupported','budget_exhausted')),
  retrieval_status text not null default 'pending' check (retrieval_status in ('pending','succeeded','unchanged','failed','unsupported')),
  extraction_status text not null default 'pending' check (extraction_status in ('pending','succeeded','no_events','failed','skipped')),
  events_found integer not null default 0,
  error_message text,
  started_at timestamptz,
  finished_at timestamptz,
  unique(sweep_run_id,source_id)
);
alter table public.source_runs add column if not exists sweep_run_id uuid references public.sweep_runs(id);
create table public.sweep_candidates (
  id uuid primary key default gen_random_uuid(),
  sweep_run_id uuid not null references public.sweep_runs(id) on delete cascade,
  event_id uuid not null references public.events(id) on delete cascade,
  verification_state text not null check (verification_state in ('supported','incomplete','conflicting','unverified')),
  local_relevance smallint not null check (local_relevance between 0 and 2),
  distinctiveness smallint not null check (distinctiveness between 0 and 2),
  audience_fit smallint not null check (audience_fit between 0 and 2),
  timeliness smallint not null check (timeliness between 0 and 2),
  usefulness smallint not null check (usefulness between 0 and 2),
  total_score smallint generated always as (local_relevance+distinctiveness+audience_fit+timeliness+usefulness) stored,
  rationale text not null,
  rubric_version text not null,
  review_state text not null default 'pending' check (review_state in ('pending','approved','rejected','deferred')),
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  rejection_reason text,
  created_at timestamptz not null default now(),
  unique(sweep_run_id,event_id)
);
create index sweep_candidates_rank_idx on public.sweep_candidates(sweep_run_id,total_score desc);
create table public.event_evidence (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  source_id uuid not null references public.sources(id),
  observation_id uuid references public.event_sources(id) on delete set null,
  sweep_run_id uuid references public.sweep_runs(id) on delete set null,
  field_name text not null,
  supported_value jsonb,
  evidence_excerpt text,
  source_url text,
  retrieved_at timestamptz not null,
  content_fingerprint text,
  created_at timestamptz not null default now(),
  unique(observation_id,field_name,content_fingerprint)
);
create table public.event_change_proposals (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  sweep_run_id uuid not null references public.sweep_runs(id) on delete cascade,
  observation_id uuid references public.event_sources(id) on delete set null,
  field_name text not null,
  old_value jsonb,
  proposed_value jsonb,
  evidence_excerpt text,
  proposal_fingerprint text not null,
  status text not null default 'pending' check (status in ('pending','accepted','rejected')),
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  unique(event_id,proposal_fingerprint)
);
create table public.duplicate_suggestions (
  id uuid primary key default gen_random_uuid(),
  sweep_run_id uuid not null references public.sweep_runs(id) on delete cascade,
  event_id uuid not null references public.events(id) on delete cascade,
  possible_duplicate_event_id uuid not null references public.events(id) on delete cascade,
  rationale text not null,
  status text not null default 'pending' check (status in ('pending','confirmed','rejected')),
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  check (event_id <> possible_duplicate_event_id),
  unique(sweep_run_id,event_id,possible_duplicate_event_id)
);
alter table public.sweep_runs enable row level security;
alter table public.sweep_run_sources enable row level security;
alter table public.sweep_candidates enable row level security;
alter table public.event_evidence enable row level security;
alter table public.event_change_proposals enable row level security;
alter table public.duplicate_suggestions enable row level security;
create policy sweep_runs_admin_all on public.sweep_runs for all to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));
create policy sweep_run_sources_admin_all on public.sweep_run_sources for all to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));
create policy sweep_candidates_admin_all on public.sweep_candidates for all to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));
create policy event_evidence_admin_all on public.event_evidence for all to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));
create policy event_change_proposals_admin_all on public.event_change_proposals for all to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));
create policy duplicate_suggestions_admin_all on public.duplicate_suggestions for all to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));
grant select,insert,update on public.sweep_runs,public.sweep_run_sources,public.sweep_candidates,public.event_evidence,public.event_change_proposals,public.duplicate_suggestions to authenticated;

