# HeyNow — Current Project State

**Last reconciled:** 2026-10-23 (America/Denver)  
**Canonical repository:** `ajcorrado/heynow`  
**Production branch:** `main`  
**Production-branch SHA:** `93bc46bf90df75ad47cfeb07210a450eacfcec5f`  
**Current bounded work branch:** `ops/manual-first-editorial-pilot`

This is the starting point for HeyNow work. Inspect current code and live systems when a task depends on them. The completed Instagram V1 execution record and the active manual-first pilot are in `ops/v1-launch.yaml`. Edition 1 candidates are in `ops/edition-1-shortlist-2026-10-26.md`.

Do not rely on prior chat history as project state.

---

## 1. What HeyNow is

HeyNow is a hyperlocal event-discovery and editorial product launching first in El Paso. It should broadly capture trustworthy local-event information, preserve provenance, and selectively publish the small subset worth putting in front of people. The event remains the atomic content object.

Current stack: Next.js/React, Supabase/Postgres/Auth/Edge Functions, Vercel, and GitHub.

---

## 2. Locked product, integrity, and publication decisions

Preserve these unless Adam explicitly changes them or new implementation evidence creates a genuine conflict.

- El Paso is the flagship market.
- The repository captures broadly; the public/editorial product curates selectively.
- Source evidence, canonical event facts, editorial content, and publication approval are separate layers.
- Discovery candidates may not bypass canonical verification or review.
- Provenance must be retained.
- Possible duplicates and geography problems are flagged without deleting evidence; false negatives are preferred over false merges.
- Approved canonical facts may not be silently overwritten by later ingestion.
- Data approval, editorial approval, and publication approval remain separate.
- Publishing edits may not mutate canonical facts or source evidence.
- AI-generated editorial work remains editable and versioned.
- Adam owns taste, final editorial judgment, and publication approval.
- The intended voice is sharp, insightful, occasionally humorous, and non-snarky.
- The visual direction is approximately 70% poster / 30% editorial utility.
- Instagram publishing remains manual.
- No production change or Instagram post occurs without Adam's explicit go/no-go.
- Authenticated admin access, Supabase RLS, audited proposals for approved material facts, and the ban on browser service-role credentials remain mandatory.

---

## 3. Verified operating state — October 23

### GitHub

Read directly from GitHub on October 23:

- default/production branch `main` remains at `93bc46bf90df75ad47cfeb07210a450eacfcec5f`;
- no pull requests are open;
- `launch/instagram-v1` remains at `284a7c8cdc24aef19d710a515ba1cbca79b00dd5` and is a completed, diverged checkpoint branch, not the production branch;
- this documentation/content pilot is isolated on `ops/manual-first-editorial-pilot`;
- no merge or production promotion is authorized by this pilot.

### Live event registry

Read-only Supabase checks on October 23 found:

- project `abxqhtwkabrblyrefsys` is `ACTIVE_HEALTHY`;
- 1,009 event rows and 31 source rows;
- 55 active event occurrences from October 26 through November 1;
- every checked Edition 1 candidate is still `pending` for data, editorial, and publication review.

The registry is therefore a lead pool, not publication authority. First-party corroboration and all three human approval gates are still required.

### Instagram application

Instagram Publishing V1 was merged to `main` in PR #4 on October 12. The production application release is recorded as complete in prior project state; that deployment was not re-tested in this documentation/content pass. Posting remains manual, and no post in the three-edition pilot is authorized yet.

---

## 4. Current milestone — manual-first editorial pilot

The next outcome is three deliberately small, human-reviewed El Paso Instagram editions:

| Edition | Target date | Working content window | Current state |
| --- | --- | --- | --- |
| 1 | Monday, October 26, 2026 | October 29–November 1 | 13-candidate shortlist prepared; awaiting Adam's 3–8 selections |
| 2 | Wednesday, October 28, 2026 | next useful near-term window | not started |
| 3 | Friday, October 30, 2026 | next useful near-term window | not started |

The dates are editorial targets, not permission to publish.

Each edition follows the same bounded loop:

1. assemble 10–15 credible candidates;
2. verify date, time, place, and live link, preferring first-party evidence;
3. have Adam select 3–8 events;
4. complete data review for selected events;
5. complete editorial review and copy together;
6. obtain separate publication approval and explicit go/no-go;
7. manually post to Instagram and record the URL only after approval;
8. capture keep/reject reasons and process lessons for the next edition.

No approval state was changed during shortlist preparation.

---

## 5. Infrastructure freeze

Until the three editions are completed and reviewed, freeze work that does not directly unblock a selected event or safe manual publication:

- source-radar implementation or broad source reconciliation;
- new adapters, bulk source activation, or ten-source acceptance;
- automated ingestion scheduling;
- schema or canonical-model redesign;
- newsletter delivery, public-site expansion, or consumer accounts;
- direct or scheduled Instagram API publishing;
- monitoring/management products;
- architecture rewrites, speculative automation, and additional cities.

Exceptions require a concrete selected-event gap, a production incident, or a security/data-integrity need. Any exception must be narrowly scoped and recorded before implementation.

---

## 6. Edition 1 status and recommended mix

The evidence-backed shortlist is `ops/edition-1-shortlist-2026-10-26.md`.

Suggested six-event mix for Adam's review:

1. Shapeshifters — experimental Borderland screen dance;
2. Last Thursday at The Falstaff — local galleries, studios, market, and music;
3. Candlelight: A Haunted Evening of Halloween Classics — paid date-night/culture option;
4. Freedom Fright — free all-ages option;
5. Halloween Fest 2026 — Franklin Mountains nature-and-Halloween option;
6. Día de los Muertos Festival at San Elizario — strong regional tradition and community close.

This is an editorial recommendation only. All six remain unapproved for publication. Recorded conflicts and weaker-evidence candidates must be resolved before use.

---

## 7. Required protocol

At the start of work:

1. read this file;
2. read `ops/v1-launch.yaml`;
3. for Edition 1, read `ops/edition-1-shortlist-2026-10-26.md`;
4. fetch current branch and open-PR state;
5. re-open each selected event's evidence before factual approval;
6. use the Event Registry's data, editorial, and publication gates separately.

At completion report: status, changed files/behavior/schema/deployments, verification, blockers, Adam actions, next single action, and exact state updates.

---

## 8. Next single action

**Adam reviews the Edition 1 shortlist, chooses 3–8 events, and gives keep/reject reasons.** Then complete factual review only for those selections and draft the carousel together. Stop again for publication go/no-go.

---

## 9. State hierarchy

If records disagree, use:

1. live/runtime evidence for current behavior and availability;
2. current code and migrations;
3. the active manual-first pilot block in `ops/v1-launch.yaml`;
4. this file;
5. the archived Instagram V1 sprint record in `ops/v1-launch.yaml`;
6. `docs/ENGINEERING.md`;
7. old PRs, issues, project documents, and chats as historical evidence.

Do not erase a locked decision because a faster manual path is being used. The pivot changes sequencing and investment level, not integrity or approval standards.
