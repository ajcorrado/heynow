-- KTEP adapter registry wiring + cross-source unique-yield semantics
update public.sources
set parser_key='ktep',
    ingestion_method='structured_html',
    automation_difficulty='medium',
    adapter_status='prototype',
    polling_minutes=360,
    updated_at=now()
where name='KTEP Community Calendar';

create or replace view public.source_registry_metrics
with (security_invoker = true)
as
with runs_30d as (
  select
    source_id,
    count(*) filter (where started_at >= now() - interval '30 days') as runs_30d,
    coalesce(sum(observations_found) filter (where started_at >= now() - interval '30 days'),0) as events_seen_30d,
    coalesce(sum(error_count) filter (where started_at >= now() - interval '30 days'),0) as failure_count_30d,
    max(finished_at) filter (where status='success') as last_successful_ingest_at,
    max(finished_at) filter (where status='failed' or error_count > 0) as last_failure_at
  from public.source_runs
  group by source_id
),
obs_30d as (
  select
    source_id,
    count(*) filter (where last_seen_at >= now() - interval '30 days') as observations_30d,
    count(distinct event_id) filter (where last_seen_at >= now() - interval '30 days') as distinct_events_30d
  from public.event_sources
  group by source_id
),
attribution_30d as (
  select
    a.source_id,
    count(distinct a.event_id) filter (where es.last_seen_at >= now() - interval '30 days') as attributed_events_30d,
    count(distinct a.event_id) filter (where es.last_seen_at >= now() - interval '30 days' and a.is_unique_to_source) as unique_events_30d,
    count(distinct a.event_id) filter (where es.last_seen_at >= now() - interval '30 days' and not a.is_unique_to_source) as overlapping_events_30d
  from public.source_event_attribution a
  join public.event_sources es
    on es.event_id=a.event_id and es.source_id=a.source_id
  group by a.source_id
),
editorial_30d as (
  select
    a.source_id,
    count(distinct a.event_id) filter (
      where ee.data_review_state='approved'
        and a.first_seen_from_source_at >= now() - interval '30 days'
    ) as events_accepted_30d,
    count(distinct a.event_id) filter (
      where ee.data_review_state='rejected'
        and a.first_seen_from_source_at >= now() - interval '30 days'
    ) as events_rejected_30d,
    count(distinct a.event_id) filter (
      where ee.data_review_state='approved'
        and a.is_unique_to_source
        and a.first_seen_from_source_at >= now() - interval '30 days'
    ) as unique_accepted_events_30d,
    count(distinct a.event_id) filter (
      where a.was_first_source
        and a.first_seen_from_source_at >= now() - interval '30 days'
    ) as first_source_events_30d
  from public.source_event_attribution a
  left join public.event_editorial ee on ee.event_id=a.event_id
  group by a.source_id
)
select
  s.id as source_id,
  coalesce(r.runs_30d,0) as runs_30d,
  coalesce(r.events_seen_30d,0) as events_seen_30d,
  coalesce(a.unique_events_30d,0) as events_unique_30d,
  coalesce(a.overlapping_events_30d,0) as events_matched_30d,
  coalesce(r.failure_count_30d,0) as failure_count_30d,
  r.last_successful_ingest_at,
  r.last_failure_at,
  coalesce(o.observations_30d,0) as observations_30d,
  coalesce(o.distinct_events_30d,0) as distinct_events_30d,
  case
    when coalesce(a.attributed_events_30d,0)=0 then null
    else round(a.overlapping_events_30d::numeric / nullif(a.attributed_events_30d,0),4)
  end as duplicate_rate_30d,
  case
    when coalesce(a.attributed_events_30d,0)=0 then null
    else round(a.unique_events_30d::numeric / nullif(a.attributed_events_30d,0),4)
  end as ingestion_unique_yield_rate_30d,
  case
    when r.last_failure_at is not null and (r.last_successful_ingest_at is null or r.last_failure_at > r.last_successful_ingest_at) then 'degraded'
    when r.last_successful_ingest_at is null and s.adapter_status='active' then 'untested'
    when r.last_successful_ingest_at is null then 'not_automated'
    when s.polling_minutes is not null and r.last_successful_ingest_at < now() - make_interval(mins => greatest(s.polling_minutes * 3,1440)) then 'stale'
    else 'healthy'
  end as health,
  case
    when s.coverage_score is null or s.content_quality_score is null or s.uniqueness_score is null or
         s.authority_score is null or s.freshness_score is null or s.data_completeness_score is null or s.geo_precision_score is null
      then null
    else round((
      s.uniqueness_score * 0.25 +
      s.content_quality_score * 0.20 +
      s.coverage_score * 0.15 +
      s.authority_score * 0.15 +
      s.freshness_score * 0.10 +
      s.data_completeness_score * 0.10 +
      s.geo_precision_score * 0.05
    ) * case s.automation_difficulty
      when 'low' then 1.00
      when 'medium' then 0.90
      when 'high' then 0.70
      when 'very_high' then 0.50
      else 1.00
    end,3)
  end as adjusted_source_value,
  coalesce(e.events_accepted_30d,0) as events_accepted_30d,
  coalesce(e.events_rejected_30d,0) as events_rejected_30d,
  coalesce(e.unique_accepted_events_30d,0) as unique_accepted_events_30d,
  coalesce(e.first_source_events_30d,0) as first_source_events_30d,
  case
    when coalesce(e.events_accepted_30d,0)+coalesce(e.events_rejected_30d,0)=0 then null
    else round(e.events_accepted_30d::numeric/nullif(e.events_accepted_30d+e.events_rejected_30d,0),4)
  end as acceptance_rate_30d,
  case
    when coalesce(e.events_accepted_30d,0)=0 then null
    else round(e.unique_accepted_events_30d::numeric/nullif(e.events_accepted_30d,0),4)
  end as unique_yield_rate_30d
from public.sources s
left join runs_30d r on r.source_id=s.id
left join obs_30d o on o.source_id=s.id
left join attribution_30d a on a.source_id=s.id
left join editorial_30d e on e.source_id=s.id;
