# SLICE-02: Show the discount inside the meal plan

**Job**: JOB-001
**Effort**: ≤1 day
**Priority**: 2nd — highest content-value delta. This is the "smart/resourceful" payoff of JOB-001 made visible at the moment of decision (the plan), not buried one click deep in the recipe view.
**Depends on**: SLICE-01 (added per-meal content must land in the mobile-survivable layout).

## Learning hypothesis
"The meal plan shows meal names only; the discount connection (which store, what sale price) is invisible in the plan and only appears after clicking into recipe detail. Surfacing store + sale price per meal in the plan is what makes the plan feel discount-driven."
**Disproved if**: seeing store + sale price inline in the plan adds clutter without aiding the accept/regenerate decision (i.e. Dimitar still clicks into each recipe to understand the deal).

## Today (baseline)
`src/meal-planning/http/plan-handler.ts` `renderPlanHtml`: table rows are `Day | Slot | Meal-name` (meal name links to recipe detail when in scope). The discount total (`estimated-savings`, regular/sale totals) is shown once at the top. Per-meal store and sale price appear ONLY in `recipe-handler.ts` detail view.

The journey mockup (step 2) shows the intended target: "Monday Lunch: Red Lentil Soup — 🥕 Rote Linsen ON SALE €1.19".

## Target (delta)
Each meal row/card that references a discounted item shows, inline, the discounted ingredient's store and sale price. Non-discount meals remain clearly differentiated (they already carry `discountItemId === null`).

## IN scope
- Enrich the plan meal presentation with the store + sale price of the linked discount item.
- Visual differentiation of discount vs non-discount meals in the plan.

## OUT of scope
- Changing the plan-generation algorithm or which meals are chosen.
- The recipe detail view (already ships this data).

## Production-data acceptance
Verified against the real running server with a real generated plan for the current week, at desktop AND 375px.

## Note
The linked discount item is already available server-side (meals carry `discountItemId`; discount items carry `store` + `salePrice`). This is presentation-only — no new query shape required beyond joining data the plan context already owns.
