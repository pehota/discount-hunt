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
