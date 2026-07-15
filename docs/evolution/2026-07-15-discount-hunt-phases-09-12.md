# Evolution: discount-hunt DELIVER Wave — Increment (scraper resilience + rich logging + Aldi fix + recipe-search params)

**Date**: 2026-07-15
**Iteration**: phases 09–12, on top of the two prior finalizations (S01–S04 + UI: `2026-07-14-discount-hunt.md`; bugfix 07 + SLICE-05: `2026-07-15-discount-hunt.md`)
**Status**: COMPLETE — all 47 steps DONE; `des-verify-integrity docs/feature/discount-hunt/deliver/` confirms complete DES traces for all 47 steps; acceptance + unit suite GREEN (256 pass / 4 skip / 0 fail)

> This document covers **phases 09–12 only**. The 38-step body (S01–S05 + bugfix) is documented in the two prior evolution docs referenced above. Phases 09–12 added 9 more steps (09-01, 10-01/10-02, 11-01/11-02, 12-01…12-04), for 47 total.

---

## Feature Summary

Four bodies of work landed in this increment, turning "the scraper doesn't work" into a resilient, observable, and correct live pipeline — plus a richer recipe-search:

1. **Phase 09 — Scraper resilience.** One store failing no longer aborts the whole run; each store adapter is isolated. `ANTHROPIC_API_KEY` is decoupled so Aldi runs key-free (only the V-Markt/Haiku leg needs it). Exit code is derived from a pure mapper.
2. **Phase 10 — Rich structured logging.** A new `src/shared/logger.ts` shared-kernel logger with a pure `formatLine`; the whole scrape lifecycle is now greppable `key=value` output.
3. **Phase 11 — Aldi extraction fix (the real "scraper doesn't work").** The Aldi Publitas feed schema was misread; the fix reads nested `products[]`, keeps genuine discounts, derives an ISO end-of-week `validUntil`, de-overlaps paginated pages, and hardens the repo against silent undefined-bind SQL corruption. Live scrape now persists all 31 discounts (was 8).
4. **Phase 12 — Recipe-search params + meal-aware query.** `user_settings` gains recipe-search parameters; a pure `buildRecipeQuery` composes a meal-aware German query; recipe links on `/plan` are scoped to the configured meal types.

---

## Business Context

Single-user personal tool (Dimitar, vegetarian, Munich). This increment closes the gap between "the loop is designed" and "the loop works against the live network with real data":

| Job | Coverage before this increment | Coverage at close |
|-----|-------------------------------|-------------------|
| JOB-001: Weekly grocery planning driven by discounts | DELIVERED (but Aldi scrape under-persisted: 8/31) | DELIVERED — live Aldi scrape persists all 31 genuine discounts; one store failing no longer kills the run |
| JOB-002: Track actual grocery savings vs full price | DELIVERED | DELIVERED (unchanged) |
| JOB-003: Ensure meal plan respects dietary restrictions | DELIVERED | DELIVERED — plus recipe search is now meal-aware and preference-shaped (no "Soft Ice for dinner") |

**Live production proof (2026-07-15):** a real Aldi scrape yielded **31 discounts persisted**, and the dashboard + plan render them; a composed meal-aware recipe query + meal-type link scoping were verified live end-to-end.

---

## Work Completed (Execution Log)

### Phase 09 — Scraper resilience

| Step | Name | Result |
|------|------|--------|
| 09-01 | Per-store adapter isolation (one store failing → `failJob` + continue, not abort); `ANTHROPIC_API_KEY` decoupled (Aldi key-free, only V-Markt needs it); exit 0 if ≥1 store ok, 1 if all fail; pure `exitCodeFor` mapper | PASS |

### Phase 10 — Rich structured logging

| Step | Name | Result |
|------|------|--------|
| 10-01 | `src/shared/logger.ts` — `Logger` interface, pure `formatLine`, `ConsoleLogger` (info→stdout, warn/error→stderr, greppable `key=value`) | PASS |
| 10-02 | Instrument ScrapingService lifecycle (start/fetch/normalize/register/completed\|failed with counts), Aldi + V-Markt fetchers (slug/pages/fetched + `zero_kept` drift WARN), runner summary (`scrape.summary`, `scrape.run.done`) | PASS |

### Phase 11 — Aldi extraction fix

| Step | Name | Result |
|------|------|--------|
| 11-01 | Read nested `entry.products[]`; keep genuine discounts (nested `discountedPrice < price`); ISO `validUntil` = end-of-current-week (feed gives only a German `"d.m."` start date); de-overlap paginated ranges | PASS |
| 11-02 | Normalizer defaults missing `category` → `"unknown"`; repo guard fails loudly on undefined bindings (was: Drizzle silently dropped an undefined interpolation → malformed SQL → only 8/31 persisted) | PASS |

### Phase 12 — Recipe-search params + meal-aware query

| Step | Name | Result |
|------|------|--------|
| 12-01 | `user_settings` gains `kid_friendly`, `household_size`, `cooking_time`, `meal_types` (guarded ALTER, columns-arrive-with-effects) | PASS |
| 12-02 | Settings page fields + validation for the new recipe-search params | PASS |
| 12-03 | Pure `buildRecipeQuery(mealName, mealType, prefs)` — composes `mealName + (Mittagessen\|Abendessen) + dietary + kinderfreundlich? + "für N Personen"? + schnell? + Rezept`; `RecipeService.getRecipeForMeal(name, slot?, prefs?)` caches by composed query with a bare-name backward-compat bridge | PASS (after checkpoint — see Issues I13) |
| 12-04 | Recipe links on `/plan` scoped to `meal_types`; recipe-handler passes slot + prefs | PASS |

**Tests at close**: 256 pass, 4 skip, 0 fail (deterministic). All 47 steps DONE.

**Adversarial review**: phase 11 validated implicitly via the live runs; phase 12 explicit adversarial review — no blockers.

---

## Key Decisions

### Phase 09 — resilience decisions

- **Per-store adapter isolation.** The runner loops stores; a failing store is recorded via `failJob` and the loop **continues** rather than aborting. A single flaky store no longer denies the user every other store's fresh data.
- **API-key decoupling.** `ANTHROPIC_API_KEY` is only required by the V-Markt leg (Haiku vision extraction). Aldi (plain Publitas JSON) runs key-free. The key check is scoped to the store that needs it, not the process.
- **Exit code as a pure mapper.** `exitCodeFor(summary: StoreResult[])` returns 0 if ≥1 store succeeded, 1 if all failed (and 1 for an empty summary). Pure and unit-tested; the runner's only impurity is calling `process.exit(exitCodeFor(...))`.

### Phase 10 — logging decisions

- **Logging is a shared-kernel concern, pure at its core.** `formatLine(level, event, fields)` is a pure function producing greppable `key=value` lines; `ConsoleLogger` is the thin effectful shell (info→stdout, warn/error→stderr). This keeps log *format* unit-testable and log *routing* trivial.
- **Instrument the lifecycle, not ad-hoc points.** Events follow the ScrapeJob lifecycle vocabulary (start/fetch/normalize/register/completed\|failed with counts), plus a `zero_kept` drift WARN when a fetch returns items but none survive the discount filter — the earliest signal of a schema drift like the phase-11 bug.

### Phase 11 — Aldi extraction decisions (recorded in the SPIKE addendum)

- **The feed schema was misread.** Aldi's Publitas `hotspots_data.json` `type: "product"` entries **nest** items under `products: []`. A genuine discount is nested `discountedPrice < price`. See `spike/findings-03-store-scraping.md` (addendum, 2026-07-15).
- **`validUntil` is derived, not read.** The feed supplies only a German `"d.m."` **start** date (`customLabel1`) — no year, no end date. The normalizer sets `validUntil` to an ISO end-of-current-week date.
- **De-overlap pagination.** Paginated ranges overlap; the fetcher dedupes across pages.
- **Fail loudly on undefined binds.** A missing `category` defaulted to `"unknown"`; more importantly the SQLite repo now **fails loudly** on any undefined bind value. The pre-fix silent behavior (Drizzle dropping an undefined interpolation → malformed SQL) is what persisted only 8 of 31 items.

### Phase 12 — recipe-search decisions

- **`user_settings` are RECIPE-SEARCH params.** `kid_friendly`, `household_size`, `cooking_time`, `meal_types` shape the recipe query and recipe scope — they are not dietary/budget filter inputs on the discount feed.
- **Meal-aware query is the "no Soft Ice for dinner" mitigation.** `buildRecipeQuery` injects a meal-type term (`Mittagessen` for lunch, `Abendessen` for dinner) so the dinner search is biased toward dinner recipes rather than dessert-style hits.
- **Backward-compatible service bridge.** `getRecipeForMeal(mealName, mealType?, prefs?)` composes the meal-aware query **only** when BOTH `mealType` and `prefs` are supplied (the 12-04 path); otherwise it keys on the bare meal name (the pre-12-03 behavior the recipe-handler relied on). This let 12-03 land the composer without breaking existing recipe-detail ATs in a single step.
- **Meal-type-scoped links.** Recipe links on `/plan` are rendered only for the configured `meal_types`.

---

## Issues Encountered and Resolution

| ID | Issue | Resolution |
|----|-------|------------|
| I13 | 12-03 GREEN blocked: `recipe-detail.test.ts` used a bare-keyed `FakeRecipeSource` incompatible with the new composed-query contract, and that file was outside 12-03's `files_to_modify` scope | RESOLVED — checkpoint raised; the backward-compat bridge (`getRecipeForMeal` composes only when slot+prefs both present) reconciled the composed-query contract with the bare-name callers; 12-03 then landed GREEN and 12-04 wired the full slot+prefs path |
| I14 | Aldi live scrape persisted only 8 of 31 discounts | RESOLVED (11-01/11-02) — nested-`products[]` read + genuine-discount filter + repo fails loudly on undefined binds; live run now persists 31/31 |
| I15 | One store failing aborted the entire scrape run | RESOLVED (09-01) — per-store isolation; `failJob` + continue; exit code derived from `exitCodeFor` |
| I16 | `ANTHROPIC_API_KEY` was required process-wide, blocking the key-free Aldi leg | RESOLVED (09-01) — key requirement scoped to the V-Markt/Haiku leg only |

Carried-forward from prior iterations: I2 (HTTP error boundary on plan generation) and I4 (D23 failure-injection test) remain open, not in this scope.

---

## Lessons Learned

1. **"The scraper doesn't work" was a schema-read bug, not an infrastructure bug.** The Publitas feed nested products one level deeper than the SPIKE-01 addendum assumed. The observable symptom (few items) pointed at the network; the cause was in the ACL's parse. A `zero_kept`/low-yield WARN log (phase 10) is now the tripwire for the next such drift.

2. **A silent ORM interpolation is a data-loss bug.** Drizzle silently dropped an undefined bind, emitting malformed SQL that persisted a subset of rows without erroring. Defaulting the field fixed the immediate case; **making the repo fail loudly on undefined binds** fixed the *class*. Silent partial success is worse than a loud failure.

3. **Resilience is per-unit isolation plus an honest exit code.** Isolating each store adapter (fail one, continue the rest) and deriving the exit code from a pure `exitCodeFor` mapper turns "all-or-nothing" into "best-effort with a truthful signal" — the right posture for a weekly best-effort scrape.

4. **Scope the secret to the leg that needs it.** Requiring `ANTHROPIC_API_KEY` process-wide coupled the key-free Aldi path to the Haiku-dependent V-Markt path. Scoping the check to the V-Markt leg removed a false prerequisite.

5. **A backward-compat bridge lets a contract change land in one step without a cross-file test rewrite.** Making `getRecipeForMeal`'s new params optional (compose only when both present) reconciled the new composed-query contract with existing bare-name callers, converting a blocked cross-scope edit (I13) into a clean single-step landing.

6. **Pure format + thin shell keeps logging testable.** `formatLine` (pure) + `ConsoleLogger` (routing shell) means the greppable `key=value` contract is unit-tested and the effectful part is trivial.

---

## Open Questions Carried Forward / Known Deferrals

| ID | Item | Status |
|----|------|--------|
| DEF-1 | Breakfast slot | Deferred — needs a plan-reshape (plan currently lunch/dinner only) |
| DEF-2 | German `productType` → dietary tags | Deferred — vegan users currently miss some Aldi items whose German product type isn't mapped to a dietary tag |
| DEF-3 | V-Markt extraction quality | Deferred — Haiku extraction quality not yet hardened |
| DEF-4 | Budget mid-week regenerate | Deferred — needs a savings-row-count guard before allowing mid-week regeneration |
| OQ-5 | Docker overlayfs SQLite fsync | Open — Platform / DEVOPS wave |
| D36 | 4-week recipe rotation (`getRecentRecipeIds`) | Deferred — future increment |

---

## Permanent Artifact Links

| Artifact | Location |
|----------|----------|
| Architecture SSOT (updated in this increment) | `docs/product/architecture/brief.md` (Catalogue Scraping isolation + key decoupling + logger; shared-kernel logger.ts; user_settings recipe-search columns; Recipe Matching recipe-query.ts; DELIVER reconciliation 09–12 subsection + deferrals) |
| Aldi feed schema finding | `docs/feature/discount-hunt/spike/findings-03-store-scraping.md` (addendum, 2026-07-15) |
| Prior iteration evolution (S01–S04 + UI) | `docs/evolution/2026-07-14-discount-hunt.md` |
| Prior iteration evolution (bugfix 07 + SLICE-05) | `docs/evolution/2026-07-15-discount-hunt.md` |
| Shared-kernel logger | `src/shared/logger.ts` |
| Scraper runner (per-store isolation, `exitCodeFor`) | `src/scraping/scraper-runner.ts` |
| Aldi fetcher (nested `products[]`, de-overlapped pages) | `src/scraping/adapters/aldi-sud-catalogue-fetcher.ts` |
| Catalogue normalizer (`category` default, ISO end-of-week `validUntil`) | `src/scraping/adapters/catalogue-normalizer.ts` |
| Pure recipe-query composer | `src/recipe/recipe-query.ts` (`buildRecipeQuery`) |
| Recipe service (meal-aware, bare-name bridge) | `src/recipe/recipe-service.ts` (`getRecipeForMeal(name, slot?, prefs?)`) |
| Settings page (recipe-search params) | `src/preferences/http/settings-handler.ts` |

---

## Migration Notes (Phase B)

No migration performed. All lasting artifacts already live in permanent locations (`src/`, `docs/product/architecture/brief.md`, `docs/feature/discount-hunt/spike/`). The `docs/feature/discount-hunt/` workspace is preserved intact (the wave matrix depends on it). The DELIVER JSONs (`roadmap.json`, `execution-log.json`, `.develop-progress.json`) are committed as the audit trail. No destructive cleanup.
