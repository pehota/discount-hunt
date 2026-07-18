# DESIGN Wave Decisions — meal-plan-engine

**Wave**: DESIGN (application/component) · **Date**: 2026-07-17 · **Agent**: Morgan (nw-solution-architect)
**Mode**: propose · **Density**: lean Tier-1 · **Paradigm**: OOP / hexagonal · **Type**: BROWNFIELD extension

---

## Summary

Extend the shipped modular monolith (no new style, no new bounded context). The meal-plan engine reshapes
the Meal Planning CORE (draft lifecycle + multi-product meals + cost objective + deduped savings) and the
Recipe Matching supporting context (basket→verified-candidate provider + dietary verifier), reusing the
shipped `RecipeService`/`ChefkochRecipeSource` (primary/sole source)/`buildRecipeQuery`/`ShoppingListService`. D37 purity of
`generatePlan` is PRESERVED — recipe fetch + dietary verify are SHELL effects, not in the pure core.

## Decisions (D38–D45) — see feature-delta.md DESIGN sections for full table

| ID | Decision | Verdict |
|----|----------|---------|
| D38 | Effect boundary | Fetch + verify are shell effects; `generatePlan` stays pure (D37 preserved) |
| D39 | Recipe sourcing MECHANISM | **ACCEPTED — ADR-006, Option D LOCKED (user sign-off 2026-07-17).** Cron-one-shot cache-warm; cold-cache fallback to B (live throttled). Warm/live TARGET = Chefkoch site-search (ADR-008 reverted to Chefkoch 2026-07-18) |
| **D39b** | Recipe **SOURCE** | **SUPERSEDED (2026-07-18).** ADR-008's Google multi-site choice was reverted to **Chefkoch-primary** when the Google Custom Search JSON API proved unbuildable (discontinued + closed to new customers; cheap-search-API category collapsed). Chefkoch is the sole source behind the unchanged `RecipeSource` port. See ADR-008 Supersession |
| D40 | Dietary verifier | NEW deterministic word-boundary German-focused blocklist over free-text recipe ingredients — **SPIKE RUN-5 0-leak proof holds (Chefkoch); verifier is defense-in-depth; residual measured over first weeks (recommended, not blocking)** |
| D41 | adr-005 | EXTENDED (addendum), NOT superseded |
| D42 | Draft state | SQLite single-user draft singleton (ADR-007) |
| D43 | Multi-product `Meal` | `discountItemIds[]` array |
| D44 | Deduped savings | Dedup over used-product set; replace-on-save guard orthogonal + unchanged |
| D45 | LLM query-building | Optional, off by default; refusal-sentinel mandatory if enabled |

## Decisions requiring USER SIGN-OFF — RESOLVED

1. **Recipe-sourcing mechanism (ADR-006, D39) — RESOLVED (user sign-off 2026-07-17): Option D ACCEPTED.**
   Bounded background cache-warm keyed to this week's deals (cron one-shot post-Monday-scrape), cold-cache
   fallback to live-throttled fetch (Option B behavior). The user **explicitly accepted the paced-warm ToS
   posture** (weekly gentle automated batch fetch = same per-fetch manners as the shipped per-meal fetch, at
   higher weekly volume; backs off if the site pushes back). A (heavy corpus) and C (English-first API)
   rejected; B retained as the documented cold-cache fallback. slice-01b unblocked.

## Reuse Analysis verdict

**Reuse-dominant.** 2 REUSE-verbatim (list read, add-to-list) + `RecipeSource` port reused source-agnostic
with the shipped `ChefkochRecipeSource` as the primary/sole source (ADR-008 reverted 2026-07-18); EXTEND
(`generatePlan` core, draft orchestration, `getRecipeForMeal`, `buildRecipeQuery`, savings); CREATE-NEW
(`RecipeCandidateProvider`, `DietaryVerifier`, `PlanDraftRepository`, cache-warmer). Every CREATE-NEW
justified: no existing component performs its function. (The ADR-008 Google adapter + composite scaffolds
were deleted on the revert — dead-API clutter; the port covers future adapters.) Full table in
feature-delta.md `## Wave: DESIGN / [REF] Reuse Analysis`.

## Outcome Collision Check

`nwave-ai outcomes check-delta docs/feature/meal-plan-engine/feature-delta.md` → **exit 0**
("0 outcomes checked, 0 collisions found across 0 outcomes"). CLI v3.21.0 present; but
`docs/product/outcomes/registry.yaml` does NOT exist → the pass is vacuous (no populated registry to
collide against). Gate honored; proceed.

## C4 diagrams

System Context: **UNCHANGED — no new external system** (ADR-008 reverted to Chefkoch-primary 2026-07-18; the
2026-07-17 Google Custom Search external-system node was removed when the API proved unbuildable). chefkoch.de
is the primary/sole recipe source behind the `RecipeSource` port.
Container (L2): **LOCKED under Option D (accepted 2026-07-17) — GAINS a cron-invoked recipe cache-warmer
one-shot** (same shape as the shipped `scrape.ts` one-shot, scheduled post-Monday-scrape — reuses D12 cron
+ D18 one-shot, no new process class, no daemon). Cold-cache fallback path uses the live-throttled (Option B)
behavior per basket but adds no execution unit.
Component diagram for the recipe-sourcing + dietary-verifier subsystem: added to brief.md
`## Wave: DESIGN / [REF] meal-plan-engine` (the complex subsystem this feature introduces).

## SSOT updates written

- `docs/product/architecture/brief.md` — `## Application Architecture` extended (new components, ports,
  Reuse rows, recipe-sourcing+verifier C4 component diagram, decisions D38–D45).
- `docs/product/architecture/adr-006-recipe-sourcing-mechanism.md` (Accepted — Option D locked 2026-07-17; warm/live TARGET = Chefkoch site-search, ADR-008 reverted 2026-07-18).
- `docs/product/architecture/adr-008-recipe-source-selection.md` (**SUPERSEDED 2026-07-18** — reverted from Google multi-site to Chefkoch-primary; external-API discontinuation).
- `docs/product/architecture/adr-007-server-side-draft-state.md` (Accepted).
- `docs/product/architecture/adr-005-dietary-filter-enforcement.md` — addendum (EXTEND, not supersede).
- `docs/feature/meal-plan-engine/feature-delta.md` — DESIGN sections appended.
- `docs/feature/meal-plan-engine/design/upstream-changes.md` — ≥2→≥1 + 2 bug fixes + verifier AC.

## Peer review (solution-architect-reviewer, iteration 1)

**Verdict: CONDITIONALLY APPROVED — 0 critical, 1 high, 3 medium.** All addressed (no iteration 2 needed):
- HIGH (DietaryVerifier blocklist completeness vs hard JOB-003) → RESOLVED: gold-test keyword-family
  corpus + pre-ship 30+-basket residual-leak measurement gate + runtime 100%-guardrail alert added to
  upstream-changes.md UC-3 + adr-005 addendum.
- MED (adr-005 dependency-cruiser status) → RESOLVED: enforcement-status note added to adr-005 (DELIVER-gated;
  extend the rule to `DietaryVerifier`).
- MED (cold-cache degradation path, Option D) → RESOLVED: fallback-to-live + explicit empty-state, never
  silent/fabricated — added to adr-006 + upstream-changes.md UC-3.
- MED (refusal-sentinel code location) → RESOLVED: named `src/recipe/adapters/llm-recipe-query.ts` (new,
  only if LLM path enabled) + regression test — upstream-changes.md UC-3.
- Sole remaining condition: **user lock on ADR-006** → RESOLVED (Option D accepted 2026-07-17); slice-01b
  unblocked. slice-01a already proceeding in parallel.

## Unresolved contradictions (carried to user / DELIVER)

1. **Task pointer mismatch (≥2 bar):** the task pointed the ≥2→≥1 change at "US-MPE-03 AC + KPI-3", but the
   text there already reads ≥1 (US-MPE-03/KPI-2) and KPI-3 is a different (breadth-coverage) metric. The ≥2
   bar lives in the SPIKE + slice-00/01b + error-path + Risks. Recorded where it truly is (upstream-changes
   UC-1); pointer flagged rather than force-edited.
2. **Residual dietary leak rate** on Chefkoch — the SPIKE RUN-5 0-leak proof holds (Chefkoch is the shipped
   source; ADR-008 reverted). The `DietaryVerifier` (German-focused word-boundary blocklist) is
   defense-in-depth. Residual is measured over the first weeks in real use — **RECOMMENDED, not a blocking
   slice-01b gate**. Ship BOTH (forced German `vegetarisch` term + verifier). No longer a #1 open risk.
3. ~~Coverage residual (ADR-008 Google multi-site)~~ **RESOLVED by revert** — Chefkoch is the baseline
   (SPIKE-proven 71% found, ≥1 anchor 100%); there is no multi-site coverage regression to weigh. KPI-4
   (≥70% slots) stays measurable in slice-01b against the Chefkoch baseline.
4. ~~CSE quota + API key (ADR-008)~~ **RESOLVED by revert** — no external API key, no quota (Chefkoch needs
   no key). The BLOCKING pre-ship CSE-quota gate is moot and removed everywhere.
