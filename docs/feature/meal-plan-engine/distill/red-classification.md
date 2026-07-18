# Pre-DELIVER Fail-for-the-Right-Reason Classification — meal-plan-engine

**Wave**: DISTILL · **Date**: 2026-07-18 · **Runner**: `bun test` (bun:test) + fast-check

Every test authored in this DISTILL run was executed once. Each failing test is classified
MISSING_FUNCTIONALITY (correct RED) vs IMPORT_ERROR/FIXTURE_BROKEN/SETUP_FAILURE (wrong RED — BROKEN)
vs WRONG_ASSERTION/OBSERVABLE_NOT_AT_PORT. **Zero BROKEN → handoff unblocked.**

## Gate 0 — typecheck (BROKEN pre-filter)

`bun run typecheck` (tsc --noEmit, strict) → **0 errors**. No ImportError / type mismatch class exists;
the six RED scaffolds carry exact TS signatures from the DESIGN contract table. This is the structural
BROKEN pre-filter for a bun project (bun transpiles without typechecking, so typecheck is the import gate).

## Layer 1 — collocated pure-unit PBT (@skip pending; RED-when-unskipped, spot-verified)

| Test file | # tests | Verdict | RED reason |
|---|---|---|---|
| `src/recipe/dietary-verifier.test.ts` | 6 | **@skip; RED-when-unskipped — MISSING_FUNCTIONALITY** | when unskipped, reaches `verifyDietary(...)` → `throw new Error("Not yet implemented — RED scaffold")`. The throw is inside the production function (assertion-equivalent), not an import failure. |
| `src/meal-planning/cost-objective.test.ts` | 3 | **@skip; RED-when-unskipped — MISSING_FUNCTIONALITY** | when unskipped, reaches `dedupedUsedProducts` / `planSpendCents` / `planRegularBaselineCents` → scaffold throw. |

**Both files are `describe.skip` (pending).** They were run once unskipped during this DISTILL session to
classify: all 9 failed via the scaffold throw (MISSING_FUNCTIONALITY, RED) — zero import/type BROKEN. They
are then re-skipped so the suite stays GREEN (the pre-push `hook:push` = typecheck+build+`bun test` MUST
stay green — a DEVOPS `coexistence_matrix` must-not-break invariant; Critical Rule 5 forbids many
simultaneously-failing tests). The `__SCAFFOLD__` markers + this table keep them discoverable; DELIVER
unskips them one at a time as its inner-loop PBT artifact (ADR-025). Full suite after re-skip:
**427 pass / 65 skip / 0 fail** (was 67 skip; ADR-008 reverted to Chefkoch removed the 2 deleted
source-degradation composite scenarios).

## Layer 4 — acceptance (real HTTP + real SQLite)

| Feature file | scenarios | State | RED reason (when un-skipped) |
|---|---|---|---|
| `walking-skeleton.feature` | 1 (2 tests) | **GREEN** | invariant rail — shipped behaviour the feature must preserve; no production code needed |
| `s01a-draft-lifecycle.feature` | 4 | @skip → RED | draft routes (`/plan/regenerate`, `/plan/save`, `/plan/discard`) 404; generate auto-saves today |
| `s01b-real-recipe-generation.feature` | 3 | @skip → RED | generation emits round-robin item-names; no real recipe title, no verifier reject wired |
| `s02-list-source.feature` | 2 | @skip → RED | no `?from=list` source path; empty-list message absent |
| `s03-cost-objective.feature` | 4 | @skip → RED | no cost objective, no deduped multi-product footer, no baseline data attrs |
| `s04-save-add-to-list.feature` | 3 | @skip → RED | save emits no add-to-list prompt; `/plan/add-to-list` route absent |
| `tech06-archive-expired-plans.feature` | 2 | @skip → RED | replace-on-save deletes prior plan; no `/plan/archive` read surface |

**Spot-check performed** (S02 empty-list, force-unskipped in a tmp copy): the test reaches the assertion in
the test body and fails on **missing content** ("Your list is empty — add items first" absent — `?from=list`
currently falls through to the normal plan render) — MISSING_FUNCTIONALITY. The unbuilt behaviour resolves as
a normal `Response`, no setup throw. Confirms the `dietary-preferences.test.ts` discipline (setup fetches
carry no `expect()`; every `expect()` in a test body) holds → un-skipping yields RED, never BROKEN.

## Verdict

- **BROKEN: 0** — handoff to DELIVER is UNBLOCKED.
- **RED (correct, @skip pending): 9 collocated unit + 18 acceptance scenarios** (one-at-a-time DELIVER cycles). (Was 20; ADR-008 reverted to Chefkoch deleted the 2 source-degradation composite scenarios. The s01b @requires_external Google residual-leak gate was also dropped but was never part of the 20 — it was the "+1" beyond the s01b 3.)
- **GREEN: 1 walking skeleton** (invariant rail, preserved-behaviour proof).
- **Full suite: 427 pass / 65 skip / 0 fail** — push gate green; no regression.
