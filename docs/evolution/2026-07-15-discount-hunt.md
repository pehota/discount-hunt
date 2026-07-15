# Evolution: discount-hunt DELIVER Wave — Increment (bugfix + SPIKE-02 closure + SLICE-05)

**Date**: 2026-07-15
**Iteration**: bugfix (phase 07) + SLICE-05 recipe integration (phase 08), on top of the 2026-07-14 finalization (S01–S04 + UI)
**Status**: COMPLETE — all 38 steps DONE; `des-verify-integrity` confirms complete DES traces for all 38 steps; acceptance + unit suite GREEN (204 pass / 4 skip / 0 fail)

> This document covers **today's increment only**. The S01–S04 + UI iteration is documented in `docs/evolution/2026-07-14-discount-hunt.md` (28 steps). Today added 10 more steps (07-01/07-02 bugfix, 08-01…08-08 recipe integration), for 38 total.

---

## Feature Summary

Two bodies of work landed today, completing the **discount → plan → cook** loop:

1. **Empty-plan freshness bugfix** (phase 07) — a stale-plan observability bug where the plan view claimed "no discounts" while the dashboard listed discounts.
2. **SLICE-05 — Recipe integration** (phase 08) — every meal in the current plan now links to a real recipe (name, ingredients, steps, source URL), with the recipe view highlighting which of its ingredients are on sale this week. **SPIKE-02 closed** on the way in: Chefkoch site-search + JSON-LD, no Brave, no API key.

---

## Business Context

Single-user personal tool (Dimitar, vegetarian, Munich). SLICE-05 closes the last open job in the core loop — turning a discount-driven meal plan into something cookable:

| Job | Coverage before today | Coverage at close |
|-----|----------------------|-------------------|
| JOB-001: Weekly grocery planning driven by discounts | DELIVERED | DELIVERED — plus a real recipe behind every meal |
| JOB-002: Track actual grocery savings vs full price | DELIVERED | DELIVERED (unchanged) |
| JOB-003: Ensure meal plan respects dietary restrictions | DELIVERED | DELIVERED — recipe ingredient highlighting respects the same `isCompatible()` predicate |

**Live production proof**: a LIVE Chefkoch smoke during the full-app e2e probe returned a real recipe with 14 ingredients — the production recipe path works end-to-end against the real network.

---

## Work Completed (Execution Log)

### Phase 07 — Empty-plan freshness bugfix

| Step | Name | Result | Date |
|------|------|--------|------|
| 07-01 | Empty-plan freshness fix: never persist an empty plan (`items.length > 0` guard); drop bogus €0 savings row | PASS | 2026-07-14/15 |
| 07-02 | Re-scope regression test D2 (had encoded the buggy stale-empty behavior); verify fix for none/vegetarian/vegan | PASS | 2026-07-15 |

**Note**: 07-01 hit a STOP-AND-FLAG checkpoint — the naive spec fix (`items.length>0`) broke the existing 03-08 D2 snapshot-discriminator AT (which encoded the buggy behavior). Resolved by re-scoping D2 via the acceptance path rather than narrowing the guard, keeping the fix clean.

### Phase 08 — SLICE-05 recipe integration

| Step | Name | Result | Date |
|------|------|--------|------|
| 08-01 | `recipes` table + schema | PASS | 2026-07-15 |
| 08-02 | `RecipeSource` port + `ChefkochRecipeSource` (live site-search + JSON-LD) | PASS | 2026-07-15 |
| 08-03 | `SQLiteRecipeRepository` (cache-first, TTL, refresh, markDead) | PASS | 2026-07-15 |
| 08-04 | `RecipeService` — cache-first, 7-day TTL, refresh-on-expiry, mark-source-dead | PASS | 2026-07-15 |
| 08-05 | `RecipeHandler` — `GET /plan/{meal_id}` detail view | PASS | 2026-07-15 |
| 08-06 | Ingredient↔discount highlighting (`data-on-sale`) + fallbacks (no-match, dead source) | PASS | 2026-07-15 |
| 08-07 | Test infra: ephemeral ports (eliminate acceptance-suite port-collision flake) | PASS | 2026-07-15 |
| 08-08 | Extract pure `ingredient-match.ts` from the handler (unit-testable heuristic, closes review WARNING B13) | PASS | 2026-07-15 |

**Tests at close**: 204 pass, 4 skip, 0 fail (1562 expect() calls, 208 tests across 27 files). All 38 steps DONE.

**Adversarial review of SLICE-05**: APPROVED, no blockers.

---

## Key Decisions

### SPIKE-02 closure (2026-07-15) — recipe source

| Decision | Outcome |
|----------|---------|
| Recipe search | **Chefkoch site-search (`suche.php`)** → first `/rezepte/…` link → JSON-LD extraction. Validated 3/3 LIVE. |
| Brave Search API | **DROPPED** — Chefkoch's own site-search removes the external search dependency entirely; no API key. |
| Testability seam | Single `RecipeSource` port; `FakeRecipeSource` in the suite (network never hit); `ChefkochRecipeSource` is the one live adapter, validated by the SPIKE probe. |
| URL recovery | Chefkoch omits `url` — fall back to `mainEntityOfPage` (proven in probe). |

### SLICE-05 design (supersedes the Brave-based brief design)

- **Two ACL ports collapsed to one.** The design SSOT planned `RecipeSearchClient` (Brave) + `RecipeFetcher` (Chefkoch). Shipped as a single `RecipeSource` port with `find(query): Promise<FetchedRecipe | null>` — read-only by design (no write method), returns null on no-hit or shape change, never throws into the domain.
- **Cache-first with 7-day TTL.** `RecipeService.getRecipeForMeal` reads cache first; refreshes on expiry; marks the source dead (`source_url_valid = false`) when the URL is unreachable, keeping cached content available.
- **Display-only ingredient↔discount matching.** `ingredient-match.ts` is a pure heuristic (case-insensitive, unit/quantity stop-words dropped, length-≥4 token guard, substring-either-direction, first-week-item-wins). A miss or the documented §9 over-match is cosmetic and NEVER affects savings math. Extracted from the handler in 08-08 so it is unit-testable in isolation.
- **Fallbacks.** No-match → show the ingredient + a Chefkoch search link. Dead source → cached content + "unavailable" notice.
- **Read-only plan lookup.** The recipe detail route looks the plan up read-only — no spurious plan generation.
- **D36 (4-week rotation) deferred** — explicitly out of SLICE-05 scope; `getRecentRecipeIds` is not on the port today.

### Bugfix decision (phase 07)

- **Never persist an empty plan.** `getOrGenerateCurrentWeekPlan` was persisting an empty plan and then returning that stale empty row forever via get-or-create, while the live dashboard showed current discounts. Fix: `items.length > 0` guard — empty plans are transient (re-query next read); non-empty plans stay frozen (weekly-commitment invariant, 03-08 D2 snapshot immutability preserved). Split is exactly `items.length === 0`.

---

## Issues Encountered and Resolution

| ID | Issue | Resolution |
|----|-------|------------|
| I8 | Plan view claimed "no discounts" while the dashboard listed discounts | RESOLVED (07-01/07-02) — empty plans no longer persisted; get-or-create re-queries live |
| I9 | Bogus €0 savings row written for empty plans | RESOLVED (07-01) — no savings row for an empty (unpersisted) plan |
| I10 | Naive `items.length>0` spec fix broke the 03-08 D2 snapshot-discriminator AT | RESOLVED (07-01 checkpoint → 07-02) — D2 re-scoped (it had encoded the buggy behavior), guard kept clean |
| I11 | Acceptance-suite port-collision flake | RESOLVED (08-07) — ephemeral ports; `createServer` binds port 0 and returns the bound port; suite deterministic |
| I12 | Ingredient-match heuristic buried in the handler, not unit-testable (review WARNING B13) | RESOLVED (08-08) — extracted to pure `ingredient-match.ts` with characterization tests (incl. known §9 over-match) |

Carried-forward from 2026-07-14: I2 (HTTP error boundary on plan generation) and I4 (D23 failure-injection test) — still open, not in today's scope.

---

## Lessons Learned

1. **A single `RecipeSource` port beat the two-adapter design.** The DESIGN SSOT planned a search client + a fetcher. Once SPIKE-02 proved Chefkoch's own site-search works, one port (`find(query)`) covered both responsibilities. Fewer seams, one fake, network never hit in the suite.

2. **Dropping Brave removed an entire external dependency and its open question.** The Brave API-key open question (OQ-1) evaporated — not by answering it, but by removing the need. Chefkoch site-search has no bot protection and needs no key.

3. **The stale-empty-plan bug is a "persistence is not caching" lesson.** Persisting a *transient* result (an empty plan for a week with no compatible items) turned a cache miss into a permanent lie. The fix is a boundary: persist only durable commitments (non-empty plans), re-derive the transient case every read.

4. **A STOP-AND-FLAG checkpoint prevented a bad fix.** The naive guard broke an existing AT. Rather than contort the production guard to satisfy a test that encoded the bug, the AT was re-scoped. The checkpoint made "the test is wrong" a first-class, reviewed decision.

5. **Ephemeral ports (bind 0, return the bound port) is the right pattern for a concurrent HTTP acceptance suite.** It eliminated a nondeterministic port-collision flake without any test-ordering hacks or fixed-port bookkeeping.

6. **Extracting the match heuristic made its honest limits testable.** As long as the heuristic lived in the handler, its documented over-match (§9) was undocumented behavior. As a pure function it gets characterization tests that assert the known failure modes on purpose — display-only, never touching savings math.

---

## Open Questions Carried Forward

| ID | Question | Status |
|----|----------|--------|
| OQ-1 (Brave key validation) | Brave Search API key | **RESOLVED — Brave dropped at SPIKE-02 closure; no key required** |
| OQ-5 (Docker overlayfs SQLite fsync) | fsync no-op risk under Docker overlayfs | Open — Platform / DEVOPS wave |
| D36 (4-week recipe rotation) | `getRecentRecipeIds` rotation window | Deferred — future increment, not in SLICE-05 |

---

## Permanent Artifact Links

| Artifact | Location |
|----------|----------|
| Architecture SSOT (updated today) | `docs/product/architecture/brief.md` (Recipe Matching rebuilt around Chefkoch; DELIVER reconciliation section added) |
| SPIKE-02 closure | `docs/feature/discount-hunt/spike/findings-02-recipe-source.md` |
| SLICE-05 design doc | `docs/feature/discount-hunt/design-slice-05-recipes.md` |
| Prior iteration evolution | `docs/evolution/2026-07-14-discount-hunt.md` |
| Recipe source port | `src/recipe/ports/recipe-source.ts` |
| Chefkoch live adapter | `src/recipe/adapters/chefkoch-recipe-source.ts` |
| Recipe repository | `src/recipe/adapters/sqlite-recipe-repository.ts` |
| Recipe service | `src/recipe/recipe-service.ts` |
| Recipe HTTP handler | `src/recipe/http/recipe-handler.ts` |
| Ingredient match heuristic | `src/recipe/ingredient-match.ts` |
| Empty-plan fix | `src/meal-planning/plan-service.ts` (`getOrGenerateCurrentWeekPlan`, `items.length > 0` guard) |

---

## Migration Notes (Phase B)

No migration performed. All lasting artifacts already live in permanent locations. The `docs/feature/discount-hunt/` workspace is preserved intact (wave matrix depends on it); the SLICE-05 design doc and SPIKE-02 closure remain in the feature workspace, referenced above. No destructive cleanup — the DELIVER JSONs (`roadmap.json`, `execution-log.json`, `.develop-progress.json`) are committed as the audit trail.
