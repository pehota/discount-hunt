# SLICE-03: Dietary restriction filter + Settings page

## Goal
Add a Settings page where Dimitar sets his dietary restriction (vegetarian), and apply that filter automatically to every meal plan generated. End-to-end: change restriction → regenerate plan → no non-compliant meals.

## IN Scope
- Settings page at `http://localhost/settings`
- Dietary restriction field: None / Vegetarian / Vegan (dropdown, single-select v1)
- Restriction persisted in user_settings table (single-row)
- Meal plan generation: filter out non-compliant items before plan construction
- Discount dashboard: filter out non-compliant items from display
- Warning when restriction produces 0 compatible meals
- Settings link shown in "No compatible meals" error state

## OUT Scope
- Multiple restriction combinations (e.g., gluten-free AND vegetarian) — future
- Allergen-level filtering — future
- Per-meal override — future

## Learning Hypothesis
**Confirms**: Vegetarian filtering meaningfully reduces the plan's variety problem (i.e., enough vegetarian discounts exist in Munich weekly flyers to fill a plan).
**Disproves if it fails**: The assumption that Munich supermarket flyers routinely include sufficient vegetarian discounts for a 7-day vegetarian meal plan. If the filter produces empty plans most weeks, the product is unviable for vegetarian users and the planner needs a "fill with non-discount vegetarian meals" fallback (documented as risk in wave-decisions D10 extension).

## Acceptance Criteria
- Settings page loads with current restriction pre-selected
- Saving a new restriction shows a toast "Settings saved"
- Next generated meal plan contains zero non-compliant meals
- If restriction produces 0 compatible meals, an error message with a Settings link appears
- Changing restriction from "vegetarian" to "none" allows meat items in next plan

## Dependencies
- SLICE-02 complete (3-store discount pool required to test filter impact meaningfully)

## Effort Estimate
≤1 day (Settings page UI + DB column + filter in plan-generation query)
Reference class: "settings form + WHERE clause + error message"

## Dogfood Moment
Dimitar sets "vegetarian" in Settings, generates a plan, and reviews it end-to-end: no meat, no fish. Done the same day SLICE-03 ships.
