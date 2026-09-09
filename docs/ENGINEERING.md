# HeyNow Engineering Brief

Last updated: 2026-09-09

## Current architecture

HeyNow currently uses:

- GitHub: `ajcorrado/heynow` — canonical source of truth
- Next.js 16 application
- Supabase/Postgres — production persistence
- Supabase Auth — internal admin access
- Supabase Edge Functions — ingestion runtime
- Vercel — application hosting target; GitHub repo and Supabase project connected in Vercel on 2026-09-09

The backend already contains canonical events, venues, sources, source runs, provenance, classifications, editorial state, and content drafts.

## Product sequencing

Locked near-term sequence:

1. ingestion/content first
2. inspect actual inventory and coverage gaps
3. expand sources based on evidence
4. substantially develop visual/product experience around real data

Design remains strategically important, but it follows ingestion.

## Ingestion architecture

Source registry and source adapters are intentionally separate.

Pipeline:

```
source registry
  ↓
adapter
  ↓
fetch
  ↓
parse/extract
  ↓
canonicalize
  ↓
venue resolution
  ↓
deduplicate
  ↓
canonical event
  ↓
event_sources provenance
  ↓
editorial review
```

Raw source material remains attached through `event_sources`.

## Canonical source registry

The persistent registry is implemented in Supabase.

Core capabilities:

- identity and URL
- type, categories, geography
- strategic roles
- P0/P1/P2/P3/manual/deprioritized tiers
- source state
- automation difficulty
- parser/adapter state
- technical risk
- 1–5 component scores
- source relationships
- priority history
- operational health
- 30-day ingestion metrics
- editorial acceptance/rejection metrics
- source attribution / first-source measurement
- unique-yield measurement
- 50-source review threshold
- review queue triggers

Current registry state as of 2026-09-09:

- 28 sources
- 12 P0
- 11 P1
- 4 P2
- 1 manual_only
- 1 active automated adapter
- 10 explicit source relationships

## Source registry — important definitions

### Strategic roles
- breadth
- authority
- edge
- discovery
- verification

### Priority tiers
- P0
- P1
- P2
- P3
- manual_only
- deprioritized

### Unique yield

The long-term critical metric is:

```
unique accepted events / accepted events
```

Before editorial review exists for a source, ingestion unique yield is shown separately.

## Source registry — current priority sources

### Visit El Paso
Status: active adapter  
Role: breadth + authority  
Method: calendar discovery + Event JSON-LD detail extraction

Observed initial ingestion:
- 285 observations
- 284 events created
- 1 matched
- 0 ingest errors
- source contamination includes some nonlocal listings

### KTEP Community Calendar
Priority: P0  
Role: breadth + edge  
Adapter: not started  
Initial scores are hypotheses until observed.

### Other P0 candidates
- City of El Paso Events
- El Paso Live
- Ticketmaster El Paso
- Eventbrite El Paso
- Bandsintown El Paso
- UTEP Events
- Lowbrow Palace
- The Falstaff
- Love Buzz
- Neon Rose

## Deduplication

Current Visit El Paso adapter uses conservative rules:

1. exact source external ID
2. existing source observation
3. exact normalized title
4. narrow time window
5. venue match where possible

False negatives are preferred over false merges in V1.

## Editorial architecture

Facts and judgment are intentionally separate.

`event_editorial` tracks:
- data review
- editorial review
- publication review

Source registry acceptance/rejection metrics use data-review state. Once events are reviewed, empirical source quality metrics become meaningful.

## Security

- RLS enabled across the core schema
- source registry views are authenticated-only
- admin policies use `private.is_admin()`
- ingestion function requires JWT
- old diagnostic/bootstrap functions are disabled and JWT-protected

Known security debt:
- `pg_trgm` remains installed in `public` and should eventually move to a private/extensions schema

## Technical debt

1. Current Visit El Paso geography parser should be upgraded before the next full run.
2. The Visit El Paso adapter is stale and needs a new run.
3. Source registry UI needs verified Vercel deployment after GitHub/Vercel integration test.
4. First Supabase Auth admin user still needs to be created.
5. Most P0 sources do not yet have adapters.
6. App currently uses client-side Supabase Auth; acceptable for internal V1 but can be upgraded to SSR session enforcement later.
7. Full pre-registry historical schema is live in Supabase but was created before this GitHub baseline; future migrations must be committed before application.

## Next engineering milestones

1. establish working Vercel deployment from this repo
2. create first admin user and verify registry UI
3. rerun Visit El Paso and verify idempotency
4. fix Visit El Paso geography normalization
5. implement KTEP adapter
6. compare KTEP incremental yield against Visit El Paso
7. choose next P0 source from measured gaps
