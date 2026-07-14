# SLICE-02: Full 7-day plan + all 3 stores

## Goal
Extend the walking skeleton to cover all 3 Munich supermarkets (Aldi Süd, Edeka, V-Markt) and generate a 7-day meal plan from the combined discount feed — lunch and dinner per day.

## IN Scope
- Scrapers: Edeka and V-Markt added alongside Aldi Süd
- Discount dashboard: items grouped by all 3 stores
- Meal plan: 7-day (lunch + dinner per day), discount-first selection across all items
- Estimated savings: total for all 7 days shown in plan footer
- Staleness warning when any scraper is older than 2 days
- Store-section "No discounts this week" if a store yields 0 items

## OUT Scope
- Dietary restriction filter (SLICE-03)
- Savings history (SLICE-04)
- Recipe links (SLICE-05)

## Learning Hypothesis
**Confirms**: Combining discounts from 3 stores produces enough variety to fill a 7-day plan without obvious repetition.
**Disproves if it fails**: The assumption that Munich's 3 supermarket discount cycles together cover sufficient ingredient variety for weekly meal planning. If the planner cannot fill 7 days meaningfully, the product concept needs rethinking (e.g., add more stores, allow pantry staples, or reduce to 5-day plan).

## Acceptance Criteria
- Items from all 3 stores appear in the dashboard, grouped by store
- 7-day plan (14 meals) generated with at least 70% of meals highlighting a discounted ingredient
- Total estimated savings displayed below plan
- Staleness warning appears when any store's data is >2 days old
- Empty store section shows "No discounts this week at {store}" message, not blank

## Dependencies
- SLICE-01 complete (scraper infrastructure + DB schema established)
- Edeka and V-Markt scraping validated (SPIKE-01 covers all 3)

## Effort Estimate
≤1 day (adding 2 scrapers + updating plan generation to use combined pool)
Reference class: "extend existing scraper pattern × 2 + widen SQL query"

## Dogfood Moment
Dimitar opens the app Monday morning after SLICE-02 ships and sees deals from all 3 stores — recognisable Munich weekly offers — and generates a realistic 7-day plan.
