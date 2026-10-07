# HeyNow Coding Agent Instructions

You are working in the HeyNow repository.

Before doing substantive work, read in this order:

1. `HEY_NOW_STATE.md`
2. `ops/v1-launch.yaml` if the assignment touches the current Instagram launch
3. relevant sections of `docs/ENGINEERING.md`
4. the actual implementation you are about to modify

Treat chat history as optional background, not authoritative state.

## Operating principle

Inspect before changing.

Documentation can be stale. Code can differ from deployed runtime. Deployed runtime can differ from the intended product.

Where practical, reconcile all three before fixing a bug.

## Source control

- `main` is the production baseline.
- Do not assume the active feature work is on `main`.
- Check `HEY_NOW_STATE.md` for the active development branch.
- Fetch before beginning work.
- Work in bounded commits.
- Do not merge into `main` or promote a deployment without explicit production approval.

Never overwrite unrelated changes.

## Product authority

You may independently resolve routine implementation details that preserve the documented product model.

Escalate only when a choice materially affects:

- product scope;
- editorial judgment;
- brand/design direction;
- canonical data semantics;
- security or data integrity;
- credentials/access;
- an irreversible external action;
- production deployment/go-no-go.

When newer user feedback conflicts with an older locked decision, surface the conflict rather than silently choosing one.

## Data model rules

Preserve the separation between:

1. source evidence;
2. canonical event facts;
3. editorial/publishing content.

Do not collapse these layers for convenience.

Never:

- delete provenance as part of normal ingestion;
- destructively merge uncertain duplicates;
- silently overwrite approved canonical facts;
- allow publishing edits to mutate canonical facts;
- expose service-role credentials in browser code;
- bypass RLS merely to make an admin feature work.

Prefer additive, reversible migrations.

## Debugging

For a reported UI bug:

1. reproduce it;
2. identify the exact deployed commit;
3. inspect browser/client behavior;
4. trace the underlying database/RPC behavior when relevant;
5. distinguish product-design confusion from implementation failure;
6. add or update automated tests where useful;
7. fix the narrowest underlying cause.

Do not implement duplicate functionality solely because the user could not find existing functionality.

## Verification

A change is not complete merely because the code looks correct.

Use the strongest relevant verification available:

- unit or contract tests;
- build/type checks;
- authenticated browser workflow;
- Supabase query/RPC verification;
- Vercel preview;
- database transaction smoke tests.

State exactly what was and was not verified.

## Active launch state

For Instagram V1, `ops/v1-launch.yaml` is the detailed execution record.

Before acting:

- verify its recorded branch/commit;
- inspect its current gate;
- read its `resume_from`;
- do not repeat already-passed work without evidence that it has regressed.

Checkpoint it after material launch work according to its continuity rules.

## Completion format

Always return:

STATUS: Complete / Partial / Blocked

CHANGED
- what changed

VERIFIED
- objective evidence

DECISIONS MADE
- implementation decisions taken

BLOCKERS
- unresolved blockers, or None

REQUIRES ADAM
- genuine product/access/production decisions, or None

NEXT ACTION
- one bounded next action

STATE UPDATE
- exact changes required in `HEY_NOW_STATE.md`
- exact changes required in `ops/v1-launch.yaml`, if applicable

## General standard

Optimize for continuity.

Another competent coding agent should be able to clone the repository after your session, read the state files, and continue without needing your conversation history.

Add coding agent continuity instructions
