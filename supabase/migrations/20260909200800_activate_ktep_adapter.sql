update public.sources
set
  adapter_status='active',
  parser_health='healthy',
  uniqueness_score=5,
  geo_precision_score=5,
  last_reviewed_at=now(),
  reviewed_by='engineering',
  review_reason='KTEP production activation after full live ingestion and idempotency validation',
  notes='Production adapter active. 93 upcoming occurrences discovered in the current 120-day horizon; 92 distinct canonical events after same-source dedupe. Current comparison with Visit El Paso shows 89 source-unique events and 3 overlaps. Recurring occurrences are keyed by Brightspot content id plus occurrence date.'
where name='KTEP Community Calendar';

update public.sources
set
  parser_health='healthy',
  last_reviewed_at=now(),
  reviewed_by='engineering',
  review_reason='Visit El Paso adapter geography hardening and full refresh',
  notes='Production breadth/authority adapter. Current refresh discovered 279 listings; one non-event was skipped. Geography normalization now preserves regional/nonlocal truth instead of defaulting to El Paso, and trailing ZIP parsing is hardened.'
where name='Visit El Paso';
