-- Activate only adapters already implemented in heynow-ingest. Each remains
-- subject to live extraction verification before production scheduling.
update public.sources
set parser_key = case name
      when 'El Paso Live' then 'el-paso-live'
      when 'Love Buzz' then 'love-buzz'
      when 'Lowbrow Palace Calendar' then 'lowbrow-palace'
      when 'The Falstaff Happenings' then 'the-falstaff'
      else parser_key
    end,
    adapter_status = 'active',
    updated_at = now()
where name in ('El Paso Live', 'Love Buzz', 'Lowbrow Palace Calendar', 'The Falstaff Happenings');

insert into public.sources (
  city_id, name, source_type, source_scope, url, ingestion_method, parser_key,
  priority, active, content_categories, source_roles, priority_tier, status,
  owner_entity, automation_difficulty, requires_browser, requires_login,
  javascript_required, expected_breakage_risk, parser_type, adapter_status,
  coverage_score, content_quality_score, uniqueness_score, authority_score,
  freshness_score, geo_precision_score, data_completeness_score,
  signal_to_noise_score
)
select c.id, 'VERSO', 'venue_calendar', 'city', 'https://www.versoelpaso.com/',
  'structured_html', 'verso', 90, true,
  array['music','arts','food','community'], array['edge','authority'], 'P0',
  'approved', 'VERSO', 'medium', false, false, false, 'medium',
  'json_ld', 'active', 2, 4, 5, 5, 4, 5, 4, 5
from public.cities c
where c.slug = 'el-paso'
  and not exists (select 1 from public.sources s where s.city_id = c.id and s.parser_key = 'verso');

