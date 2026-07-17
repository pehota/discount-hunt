# slice-00 (SPIKE): basket → real-recipe search feasibility

**Type**: Spike (time-boxed research — NOT a user-story slice) · **Timebox**: 1 day
**Job**: JOB-001 (parent JOB-004) feasibility · **Depends on**: none · **Order**: 1st (D8, riskiest-first)

> This is a **Spike task type**, not a value slice. It has no user-visible story and no Elevator Pitch
> by design (see feature-delta Dimension-0.5 note). It gates whether the whole feature is buildable.

## Learning hypothesis
**Given a basket of N discounted products + a dietary restriction, a web/Chefkoch search can return REAL
recipes that use ≥2 of the basket products AND are dietary-compatible.**
Also: does letting the LLM (`LlmTextGenerator`, `resolveLlm`) *construct the search query* materially
improve hit rate vs a rules-built query?

**Disproves X if it fails**: if no basket→real-recipe search reliably returns ≥2-product,
dietary-compatible recipes, then D1 (real-recipes-only, never LLM-invented) cannot produce a usable
plan — the feature as framed **dies or must be reshaped** (e.g. single-product recipes only). Cheapest
possible place to learn this.

## IN scope
- Probe the shipped `ChefkochRecipeSource` (`src/recipe/adapters/chefkoch-recipe-source.ts`) with
  basket-derived queries over a real week's `discount_items` (vegetarian restriction).
- Compare two query builders: (a) rules-based (extend `buildRecipeQuery`, `src/recipe/recipe-query.ts`);
  (b) LLM-built via `resolveLlm` (`src/llm/resolve-llm.ts`, `claude-cli` dev adapter).
- Measure, for a sample of baskets: recipe-found rate, ≥2-basket-product rate, dietary-compatible rate.

## OUT of scope
- Any production code, schema, or UI. Any generation-pipeline change. Any LLM-invented recipe.
- The draft lifecycle, cost objective, list-source (later slices).

## Acceptance (Spike done when)
- [ ] A short findings note records: recipe-found %, ≥2-product %, dietary-compatible % for rules vs LLM query.
- [ ] A GO/NO-GO recommendation for D1, and a recommendation on whether LLM query-building is worth its cost/latency.
- [ ] If NO-GO or partial: the reshaped scope (e.g. single-product recipes) is stated for slice-01.

## Carpaccio taste tests
- ≤1 day? Yes (time-boxed). · End-to-end user-visible? N/A (Spike). · Independently valuable? Yes —
  produces the go/no-go finding. · ≥1 non-infra story? N/A (Spike task type, exempt).

## Effort
1 day, time-boxed. Hard stop at the box; report findings even if inconclusive.
