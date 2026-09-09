-- Cover Morning Sweep foreign keys used by review and cleanup paths.
create index duplicate_suggestions_event_idx on public.duplicate_suggestions(event_id);
create index duplicate_suggestions_possible_idx on public.duplicate_suggestions(possible_duplicate_event_id);
create index duplicate_suggestions_reviewer_idx on public.duplicate_suggestions(reviewed_by);
create index event_change_proposals_sweep_idx on public.event_change_proposals(sweep_run_id);
create index event_change_proposals_observation_idx on public.event_change_proposals(observation_id);
create index event_change_proposals_reviewer_idx on public.event_change_proposals(reviewed_by);
create index event_evidence_event_idx on public.event_evidence(event_id);
create index event_evidence_source_idx on public.event_evidence(source_id);
create index event_evidence_sweep_idx on public.event_evidence(sweep_run_id);
create index source_runs_sweep_idx on public.source_runs(sweep_run_id);
create index sweep_candidates_event_idx on public.sweep_candidates(event_id);
create index sweep_candidates_reviewer_idx on public.sweep_candidates(reviewed_by);
create index sweep_run_sources_source_idx on public.sweep_run_sources(source_id);
create index sweep_run_sources_source_run_idx on public.sweep_run_sources(source_run_id);
create index sweep_runs_started_by_idx on public.sweep_runs(started_by);
