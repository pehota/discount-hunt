# SLICE-04: Recipe inspiration from a selection or from all discounts

**Job**: JOB-001 (supporting), JOB-004 (primary — ideas feed the list)
**Status**: NEW ENTRY POINT that EXTENDS shipped SLICE-05 Chefkoch recipe integration (does NOT rebuild it).
**Effort**: ≤1 day
**Priority**: 4th overall — the "inspire me" delta. Sequenced last: it is inspiration/decision-support (supporting job), and it is most useful once the list flow exists to receive its suggestions.
**Depends on**: shipped `RecipeService` + `ChefkochRecipeSource` (SLICE-05, live, cache-first 7d TTL). SOFT dependency on SLICE-02 (list to add suggested ingredients into) — the idea list is useful standalone but the "add ingredients to list" affordance needs the list.

## Learning hypothesis
"Given a SELECTION of discounted items (e.g. chicken) or ALL of this week's discounts, showing recipe ideas seeded by that set inspires what to add to the list — turning cheap raw items into a concrete plan for the shop."
**Disproved if**: Dimitar prefers to decide meals himself and never uses seeded suggestions, or the per-meal lookup already covers this need.

## Today (baseline)
Recipe integration is PER-MEAL: `GET /plan/{day}-{slot}` looks up a recipe for one planned meal via Chefkoch site-search → JSON-LD (SLICE-05, shipped). There is NO entry point that takes a user selection ("chicken") or the full discount set and returns recipe ideas. The RecipeService/ChefkochRecipeSource machinery, cache, and fallbacks all exist and are reused.

## Target (delta)
- A NEW entry point: "get recipe ideas from this selection" and "what can I cook from all this week's discounts?".
- Seeds the EXISTING Chefkoch recipe query with the selected items (or all discounted items) instead of a single planned meal.
- Each idea links to its Chefkoch source and offers "add ingredients to list" (into SLICE-02's list).
- Dietary restriction (JOB-003) constrains the query, consistent with the shipped meal-plan filter.

## IN scope
- Selection→recipe-query and all-discounts→recipe-query entry points.
- Reuse of RecipeService cache + ChefkochRecipeSource + shipped no-match/dead-source fallbacks.
- "Add ingredients to list" affordance (soft-depends on SLICE-02).

## OUT of scope
- Rebuilding recipe fetching/caching (reused as-is).
- LLM-generated recipes (parked future good-to-have, per backend Out-of-Scope).
- Kid-friendly / household-size recipe-search params (separate, already-identified recipe-query params — see memory preferences-model-split; not this slice).

## Acceptance (from journey step 5 Gherkin)
- Recipe ideas from a specific selection use those ingredients and link to their source.
- Recipe ideas from all discounts are shown when no selection is made; none violate the dietary restriction.
- No-match falls back to the shipped manual Chefkoch search; dead source shows the shipped cached notice.

## Production-data acceptance
Verified on the running server against live Chefkoch: seed from a real selection and from the full week's discounts; confirm ideas + fallbacks at desktop and 375px.
