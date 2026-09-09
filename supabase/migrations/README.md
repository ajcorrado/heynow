# Supabase migrations

The production HeyNow database predates the canonical GitHub repository.

Live migration history on 2026-09-09:

- 20260821195040 initial_heynow_schema
- 20260821195134 security_and_index_hardening
- 20260827160911 enable_http_extension_for_source_diagnostics
- 20260827162207 visit_el_paso_ingestion_foundation
- 20260827162319 add_event_url_to_events
- persistent_source_registry_v1
- seed_source_registry_initial_universe
- seed_source_registry_additional_known_sources
- source_registry_operational_review_views
- source_registry_editorial_yield_metrics_v2

This directory marks the GitHub baseline. All future schema changes must be committed here before or with production application.
