# SLICE-05: Recipe source integration

## Goal
Link each meal in the plan to a real recipe with preparation steps and a source URL, surfacing ingredient-to-discount connections in the recipe detail view. Completes the "discount → plan → cook" loop.

## IN Scope
- Recipe matching engine: given a meal name + discounted ingredient list, find a matching recipe from the chosen source (API or static DB — decided in DESIGN wave SPIKE)
- Recipe detail view at `http://localhost/plan/{meal_id}` 
- Ingredient list in recipe view: highlights which items are in this week's discount feed (store + sale price)
- Source URL linked with "Open original recipe ↗" (opens new tab)
- Cached recipe fallback: if source URL returns 404, show cached content with "unavailable" notice
- No-recipe fallback: if no match found, show ingredient list + pre-filled web search link
- "Back to meal plan" navigation

## OUT Scope
- User-saved / bookmarked recipes — future
- Personalised recipe recommendations based on past plan choices — future
- Recipe rating / feedback — future

## Learning Hypothesis
**Confirms**: Linking to real recipes completes the planning-to-cooking loop and removes the need for Dimitar to search externally, making the app a one-stop tool.
**Disproves if it fails**: The assumption that the chosen recipe source (API or DB) has sufficient vegetarian coverage for typical Munich discount ingredients. If >30% of meals in a week have no recipe match, the recipe source is insufficient and must be changed or supplemented.

## Acceptance Criteria
- Clicking any meal title opens a recipe detail view without full page reload
- Ingredient list highlights items currently in the discount feed with store and sale price
- Original recipe URL opens in a new browser tab
- If source URL is unreachable, cached content shown with "unavailable" notice
- If no recipe match exists, ingredient list + manual search link shown
- "Back to meal plan" always visible

## Dependencies
- SLICE-02 complete (meal plan with named meals required)
- SPIKE-02: Recipe source evaluation (Spoonacular, AllRecipes, static curated DB) must be complete before SLICE-05 architecture is committed

## Effort Estimate
≤1 day (recipe matching query + detail view UI + fallback handling)
Reference class: "API call + template render + 2 error states"

## Pre-slice SPIKE
SPIKE-02: Evaluate recipe source options for vegetarian coverage against Munich discount ingredients. Test query: "recipes containing Rote Linsen" — does the source return ≥1 vegetarian result? Output: `docs/feature/discount-hunt/spike-02-recipe-source.md` with recommended source and coverage estimate.

## Dogfood Moment
Dimitar generates a plan, clicks "Red Lentil Soup," sees a real recipe with the Rote Linsen sale price highlighted, and opens the original source in a tab. He cooks it that evening. The loop is complete.
