# ADR-005: Dietary Filter Enforcement Strategy

**Status**: Accepted
**Date**: 2026-07-13
**Deciders**: Architecture wave (D33)

---

## Context

The dietary restriction (`dietary_restrictions[]` from `user_settings`) must be applied consistently across three bounded contexts:

1. **Discount dashboard** (`GET /`) — items incompatible with restriction are hidden or flagged
2. **Meal plan generation** (`POST /plan/generate`) — filter applied BEFORE item selection (DISCUSS D7 constraint)
3. **Recipe view** (`GET /plan/:meal_id`) — ingredient list highlights only compatible items

The DISCUSS shared-artifacts-registry.md flags `dietary_filter` as **HIGH risk**: "if dietary_filter is applied inconsistently between plan generation and recipe view, non-compliant meals can slip through."

Three independent implementations would guarantee eventual divergence. The goal is to make divergence non-representable in code.

---

## Decision

Single pure function `isCompatible(tags: DietaryTag[], restriction: DietaryRestriction): boolean` in `src/shared/dietary.ts`.

**Properties:**
- Pure function — no I/O, no side effects, deterministic output
- Exported from the Shared Kernel (`src/shared/`)
- The only sanctioned source of dietary compatibility logic in the codebase
- All three consuming contexts import and call this function — they never reimplement the predicate

**Supporting enforcement layers (in order of strength):**

| Layer | Mechanism | What it catches |
|-------|-----------|-----------------|
| Structural | Single function in one file — only one implementation can exist | Makes divergence non-representable |
| Static | `dependency-cruiser` rule: no file outside `src/shared/` may define a function named `isCompatible` or `isDietaryCompatible` | Catches attempts to shadow the predicate |
| Static | Import-linter rule: any dietary filtering in HTTP handlers or domain services must import from `src/shared/dietary.ts` | Catches inline re-implementation |
| Behavioral | Property-based test covering all `DietaryTag × DietaryRestriction` combinations | Mutation-tested; catches logic errors in the predicate itself |
| Integration | Acceptance test for US-05 scenario: vegetarian restriction → generate plan → verify zero meat items | End-to-end behavioral contract |

**Pre-condition in `GeneratePlan`:**

```
// Enforced in plan-service.ts GeneratePlan use case:
const candidates = discountItems.filter(item =>
  isCompatible(item.dietary_tags, preferences.dietary_restrictions)
)
// meal selection runs on `candidates` only — no post-filter
```

This satisfies DISCUSS D7: "dietary_filter applied BEFORE meal selection — not after."

---

## Rationale

The shared-artifacts-registry.md integration checkpoint for `dietary_filter` reads: "restriction applied identically in all 3 consumers; no consumer derives restriction independently." A Shared Kernel pure function is the only architectural pattern that makes "applied identically" a structural guarantee rather than a documentation requirement.

A domain event / pub-sub approach was considered: `DietaryRestrictionsUpdated` triggers re-validation in each context. Rejected: adds complexity, introduces async propagation risk, and solves a consistency problem that does not exist — all three contexts read from the same SQLite row at request time.

---

## Consequences

- `src/shared/dietary.ts` is the Shared Kernel — the explicit exception to D26 ("no cross-context type imports").
- `DietaryTag` and `DietaryRestriction` types are exported from `src/shared/types.ts` and imported by any context that produces or consumes dietary data.
- The dietary keyword classifier (`src/scraping/adapters/catalogue-normalizer.ts`) is a separate responsibility: it produces `DietaryTag[]` from raw ingredient strings at scrape time. It does NOT import `isCompatible()` — it is the upstream producer, not a consumer.
- Adding a new restriction type (e.g., `vegan`, `gluten-free`) requires a change in exactly one place: `src/shared/dietary.ts`. All consumers inherit the new logic automatically.

---

## Alternatives Considered

| Alternative | Rejected because |
|-------------|-----------------|
| Each BC implements its own filter | Three implementations diverge over time; HIGH risk flag from registry becomes an incident |
| Filtering delegated to the DB query layer | SQL `WHERE` clauses cannot be property-tested as a pure function; logic duplication across 3 queries |
| Post-filter on plan output | Violates DISCUSS D7 ("applied before meal generation, not after"); may generate plans with 0 meals that weren't rejected early |
| Pub-sub on `DietaryRestrictionsUpdated` | Adds async complexity for a consistency problem that doesn't exist — all consumers read from one SQLite row |

---

## Addendum (2026-07-17, meal-plan-engine DESIGN — EXTENDED, not superseded)

The meal-plan-engine adds a SECOND dietary layer for a NEW data shape. `isCompatible(tags, restriction)`
operates on a `DiscountItem`'s pre-classified `dietary_tags[]`. The new engine surfaces **real web recipes
whose free-text ingredient lists are NOT pre-classified** — a shape this ADR's predicate cannot judge.

**This ADR stands unchanged.** The new `DietaryVerifier` (`src/recipe/dietary-verifier.ts`, D40) is an
ADDITIVE second-line gate over fetched-recipe free-text ingredients + title, using a deterministic
word-boundary non-veg blocklist. Defense-in-depth after the first-line control (the forced dietary term
injected by `buildRecipeQuery`).

> **RESTORED for Chefkoch-primary (2026-07-18 — ADR-008 superseded):** SPIKE RUN-5's "forced `vegetarisch`
> flipped leaks 40%→0%" was measured **ON CHEFKOCH**, which is again the shipped source, so this proof holds.
> The guard returns to the SPIKE §10 posture: (1) forced German term `vegetarisch` (the language-aware
> `+vegetarian` requirement is dropped — single German source); (2) German-focused blocklist below;
> (3) residual leak measured over the first weeks in real use — **RECOMMENDED, not a blocking slice-01b gate**
> (verifier is defense-in-depth). See `upstream-changes.md` UC-3.

- Layer 1 (SHIPPED): forced German dietary query term `vegetarisch` (`buildRecipeQuery`) — first-line bias.
- Layer 2 (SHIPPED): `isCompatible` on `DiscountItem.dietary_tags[]` — anchors gated at selection (this ADR).
- Layer 3 (NEW, D40): `DietaryVerifier` on the fetched RECIPE's free-text ingredients, German-focused
  blocklist (single German source) — the recipe safety gate.

The verifier is NOT the display heuristic `tokensOverlap` (that is a display-only over-matcher, being fixed
as a separate bug). Per Principle 13 its probe MUST exercise the SPIKE RUN-4 known lies (Brokkoli-gratin
`Schinken`, Schnitzel `Kalbsbrät` → both REJECTED). See adr-006, feature-delta DESIGN sections. adr-005 is
NOT superseded — the predicate and its Shared-Kernel enforcement are unchanged.

**Verifier completeness (peer-review HIGH — JOB-003 is a hard 100%-no-violation constraint):** the
blocklist gold-test corpus (German non-veg keyword families) plus the runtime 100%-guardrail alert are
specified in `docs/feature/meal-plan-engine/design/upstream-changes.md` UC-3. The RUN-5 Chefkoch 0-leak proof
holds (Chefkoch is the shipped source); the verifier is defense-in-depth. Residual leak is measured over the
first weeks in real use (recommended, not a blocking gate).

**Enforcement status note (this ADR's `dependency-cruiser` layer):** the static rule forbidding dietary
predicate re-implementation outside `src/shared/dietary.ts` is the DELIVER-gated enforcement layer (D34
configures `dependency-cruiser` as a pre-commit + CI check). For the meal-plan-engine, the same config MUST
be extended to cover the new `DietaryVerifier` (no other file may re-implement non-veg detection). Until the
rule ships, the "single source" property is enforced structurally (one file) + behaviorally (gold-test), and
the linter is the third layer — add the verifier rule in slice-01b's DELIVER work.
