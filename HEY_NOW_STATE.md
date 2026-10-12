# HeyNow — Current Project State

**Last reconciled:** 2026-10-07 18:21 MT  
**Canonical repository:** `ajcorrado/heynow`  
**Production branch:** `main`  
**Current active development branch:** `launch/instagram-v1`

This file is the starting point for any human or AI working on HeyNow.

For implementation details, inspect the code. For durable architecture, read `docs/ENGINEERING.md`. For the active Instagram V1 sprint's detailed execution state, read `ops/v1-launch.yaml`.

Do not rely on prior chat history as project state.

---

## 1. What HeyNow is

HeyNow is a hyperlocal event-discovery and editorial product launching in El Paso.

The system should broadly capture trustworthy local-event information, preserve provenance, then selectively curate the small subset of events worth putting in front of users.

The event is the atomic content object.

Current technical stack:

- Next.js
- React / TypeScript-JavaScript application
- Supabase / Postgres
- Supabase Auth
- Supabase Edge Functions
- Vercel
- GitHub

---

## 2. Locked product and architecture decisions

Preserve these unless Adam explicitly changes them or new implementation evidence creates a genuine conflict.

- El Paso is the flagship market.
- Ingestion and trustworthy event data precede broad consumer feature expansion.
- The repository captures broadly; the public/editorial product curates selectively.
- Source evidence, canonical event facts, and editorial content are separate layers.
- Provenance must be retained.
- Approved canonical facts may not be silently overwritten by later ingestion.
- Editorial approval and publication approval are separate.
- AI-generated editorial work remains editable and versioned.
- Human editorial judgment should progressively improve automation rather than be prematurely removed.
- The intended voice is sharp, insightful, occasionally humorous, and non-snarky.
- The visual direction is approximately 70% poster / 30% editorial utility.
- Publishing to Instagram is currently manual; direct Instagram API publishing is not required for V1.
- Production changes require an explicit production go/no-go.

---

## 3. Current repository state

### Production

`main` remains the production baseline at:

`2d51061e95aae3441f9d6e1fd7b1b0ee5da76939`

Do not assume development work has been merged to `main`.

### Active launch branch

Current Instagram launch work is on:

`launch/instagram-v1`

At the October 7 reconciliation, this branch contains the Publishing Desk and current Morning Sweep mitigation work and is ahead of `main`.

Before making changes:

1. fetch the latest remote branch state;
2. verify the branch head;
3. inspect `ops/v1-launch.yaml`;
4. verify the relevant Vercel preview corresponds to the expected commit.

Do not merge or promote to production without explicit approval.

---

## 4. Current active initiative — Instagram Publishing V1

Detailed authoritative sprint state:

`ops/v1-launch.yaml`

Current objective:

Allow Adam to curate 3–8 upcoming HeyNow events into an ordered Instagram carousel package, publish it manually, and record the resulting Instagram URL without modifying canonical event facts.

Current gate:

`G2_editorial_loop`

Already passed:

- baseline repository/infrastructure verification;
- additive Publishing Desk schema;
- publication-specific RLS and authorization;
- event-derived and manual draft persistence;
- revision/state-transition backend;
- source snapshots;
- audit trail;
- basic validation tests;
- transactional database smoke tests.

Production remains unchanged while this work is being tested.

---

## 5. Publishing Desk — current implementation

The development branch now treats a carousel—not a single event—as the Instagram V1 publication object:

- `/admin/publishing`
- `/admin/publishing/[id]`
- carousel creation by city
- selection, removal, and ordering of 3–8 upcoming active events
- direct Event Registry → Add to carousel handoff
- editable carousel title, cover kicker, and shared caption
- immutable per-event source/fact snapshots
- visible data-review state for every selected event
- draft / ready / posted / skipped workflow
- return from ready to draft
- restore skipped draft
- Instagram URL recording
- explicit readiness checklist

### Event → carousel behavior

Carousel creation begins in the Publishing Desk. An Event Registry detail page can also seed that event into a newly created carousel.

Editors may assemble and save drafts from upcoming active events before data review is complete. This keeps editorial compilation usable while facts are being reviewed.

Moving a carousel to `ready` remains blocked until all selected events are active and data-approved. Publishing content never mutates canonical event facts or provenance.

### Ready validation

`Save & mark ready` remains disabled until:

- carousel title
- caption
- 3–8 events are selected
- every selected event is data-approved

The editor displays each blocking condition explicitly. `Save draft` remains independently available.

### Return to draft

`ready → draft` and `skipped → draft` are supported. The Return to Draft control is displayed when status is `ready`.

---

## 6. Carousel scope decision

Adam explicitly chose carousel-only for Instagram V1 on October 7. This supersedes the earlier `feed_single` assumption and the prior deferral of carousels/roundups.

Legacy single-event rows and RPCs remain intact for data preservation, but the V1 Publishing Desk lists and creates carousel drafts only.

---

## 7. Morning Editorial Sweep incident

There is an active operational issue around the Morning Sweep.

Observed behavior:

The parent sweep timed out while child ingestion jobs continued and successfully completed.

Recorded mitigation:

- reduced per-source batch size;
- increased parent wait time;
- deployed updated `heynow-sweep` Edge Function.

Current state:

**Mitigated, awaiting authenticated verification.**

Next required verification:

Run one manual authenticated Morning Sweep.

Expected result:

- Visit El Paso succeeds;
- KTEP succeeds;
- overall sweep may still be `partial` because the remaining source adapters are unsupported;
- the UI should terminate cleanly rather than appear to spin indefinitely.

Do not interpret `partial` caused by unsupported adapters as the same failure as the timeout incident.

---

## 8. Core data integrity rules

These are non-negotiable without explicit architecture review.

- Never discard source provenance to simplify the canonical model.
- Never destructively merge possible duplicates merely for editorial convenience.
- Prefer false-negative duplicate detection over false merges.
- Never silently overwrite material facts on data-approved events.
- Changed source evidence should create a reviewable proposal.
- Canonical event data must remain independent from Instagram/editorial presentation fields.
- Publishing edits must not mutate source evidence or canonical facts.
- Keep authenticated/admin data protected through Supabase RLS.
- Never ship a Supabase service-role credential to browser code.

---

## 9. Current development priorities

Unless `ops/v1-launch.yaml` has been updated more recently, use this order:

### P0 — Reconcile actual runtime

Verify branch, preview deployment, Supabase migration state, and authenticated user experience.

### P1 — Verify carousel editorial loop

Exercise:

`create carousel → select/reorder 3–8 events → save/reload → resolve review blockers → ready → return to draft`

### P2 — Build carousel asset rendering

Generate and preview the cover plus one 1080×1350 slide per selected event, then support downloading the ordered image set for manual Instagram posting.

---

## 10. What not to work on yet

Unless promoted by an explicit project decision:

- additional cities;
- broad consumer accounts;
- comments/social feeds;
- direct Instagram API publishing;
- scheduled Instagram publishing;
- newsletter delivery;
- large infrastructure rewrites;
- broad source expansion unrelated to the current acceptance gate;
- speculative redesign of the canonical event model.

---

## 11. Required working protocol

At the start of every coding session:

1. Read this file.
2. Read `ops/v1-launch.yaml` if the work touches the Instagram launch.
3. Read relevant sections of `docs/ENGINEERING.md`.
4. Fetch and inspect current code.
5. Verify external/live state when the task depends on Supabase or Vercel.
6. Do not rely solely on documentation when code or runtime evidence can answer the question.

At completion report:

### STATUS
Complete / Partial / Blocked

### CHANGED
Files, schema, configuration, behavior, or deployments changed.

### VERIFIED
Tests, browser checks, database checks, deployment checks, or other evidence.

### DECISIONS MADE
Implementation decisions made within delegated authority.

### BLOCKERS
Only real blockers.

### REQUIRES ADAM
Only product judgment, access, irreversible action, security/data-integrity decision, or production go/no-go.

### NEXT ACTION
One bounded recommended next step.

### STATE UPDATE
Exact changes that should be made to `HEY_NOW_STATE.md` and, when applicable, `ops/v1-launch.yaml`.

---

## 12. State hierarchy

If records disagree, use this hierarchy:

1. live/runtime evidence for statements about current runtime behavior;
2. current code and migrations for implementation behavior;
3. `ops/v1-launch.yaml` for active Instagram sprint execution state;
4. `HEY_NOW_STATE.md` for project-level state and locked decisions;
5. `docs/ENGINEERING.md` for durable architecture;
6. old issues, PR descriptions, project documents, and chat transcripts as historical evidence only.

Do not overwrite a locked product decision merely because older code differs from it. Surface the conflict.

