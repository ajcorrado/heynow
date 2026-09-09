# HeyNow Engineering Brief

Last updated: 2026-09-09 (Morning Editorial Sweep V1 foundation)

## Current architecture

HeyNow currently uses:

- GitHub: `ajcorrado/heynow` — canonical source of truth
- Next.js 16 application
- Supabase/Postgres — production persistence
- Supabase Auth — internal admin access
- Supabase Edge Functions — ingestion runtime
- Vercel — application hosting target; GitHub repo and Supabase project connected in Vercel on 2026-09-09

The backend already contains canonical events, venues, sources, source runs, provenance, classifications, editorial state, and content drafts.

The internal application now has two connected Product surfaces:

- `/admin/events` — canonical Event Registry with calendar and table modes
- `/admin/sources` — ingestion Source Registry and source performance detail

Both use the existing Supabase browser client and signed-in user session. Database access remains governed by the existing RLS policies and `private.is_admin()` membership check; no service-role credential is shipped to the client.

## Event Registry and editorial review

`/admin/events` reads canonical data from `events` and its existing relationships. It does not create a second event model or a competing cached copy.

Registry capabilities:

- upcoming-event metrics and multi-source count
- calendar/agenda and table views
- date-range, source, venue, locality, event status, review-stage/state, category, and text filters
- direct navigation between event and source operations

`/admin/events/[id]` exposes canonical facts, venue/geography, classification, source attribution, source runs, source URLs, extraction confidence, raw evidence, and the complete review history.

The three gates map directly to `data_review_state`, `editorial_review_state`, and `publication_review_state`. The UI supports `pending`, `approved`, and `rejected`; data-quality flags use the schema's existing `needs_review` state. Every action also appends an `editorial_reviews` row with the stage, decision, previous/new values, reviewer ID, note, and timestamp.

Duplicate and wrong-geography actions are deliberately non-destructive: the event and its provenance remain intact, data review moves to `needs_review`, and the audit decision is recorded as `duplicate`, `wrong_geography`, or `needs_review`.

No new ingestion sources or adapters are part of this milestone.

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
- 2 active automated adapters
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
Adapter: active  
Observed current ingestion: 93 upcoming occurrences representing 92 canonical events, with full-run idempotency verified.

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

The Event Registry is the operating surface for those states. `event_editorial` holds current state while `editorial_reviews` is the append-only decision trail. Product flags do not delete canonical events or provenance.

## Security

- RLS enabled across the core schema
- source registry views are authenticated-only
- admin policies use `private.is_admin()`
- Event Registry reads and review writes run as the signed-in user and remain subject to RLS
- the browser bundle contains only the Supabase publishable key; no service-role key is used
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

## Morning Editorial Sweep V1

Implemented foundation:

- authenticated manual `heynow-sweep` Edge Function
- one-active-run-per-market lock and trigger idempotency key
- immutable ten-source snapshot per run
- separate retrieval and extraction status per source
- explicit unsupported-source reporting
- 30-day El Paso shortlist, capped at 20
- versioned deterministic 0–2 editorial rubric
- persistent candidate, evidence, proposed-change, and duplicate-review entities
- private `/admin/review` interface with run summary and audited approve/reject/defer actions
- zero model-token and zero variable-cost pilot budget

Scheduling is deliberately disabled. A successful sweep currently requires all ten
selected sources to complete, but only Visit El Paso and KTEP have active adapters.
The pilot can therefore produce a truthful `partial` run while retaining useful
results, but it cannot yet satisfy the ten-source acceptance gate.

Current unsupported reasons:

- no active adapter: City of El Paso, El Paso Live, Ticketmaster, UTEP, Lowbrow Palace, The Falstaff
- authenticated/browser retrieval outside V1: Eventbrite, Bandsintown, Love Buzz, Neon Rose as applicable

Operational blockers:

1. No Vercel project is visible in the connected team, so the review UI is not deployed.
2. No scheduler is installed; scheduling remains off until manual ten-source acceptance.
3. The current ingestion function predates change proposals and still needs approved-fact
   overwrite protection before accepted events can be refreshed safely.
4. Manual end-to-end invocation requires an authenticated editor session.
