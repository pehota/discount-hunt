# Ideas — discount-hunt

Scratch space for ideas that surface during the wave process but are out of current scope.
Not tracked by any wave. Groom manually.

---

## IDEA-001: Personal Recipe Catalogue

**Captured**: 2026-07-13 (during DESIGN wave)

**What**: Save recipes to a personal catalogue. When generating the meal plan, prefer catalogue recipes (if the 4-week rotation window allows) before searching online via Brave Search + Chefkoch.

**Generation order (proposed)**:

1. Check personal catalogue for a recipe matching the discounted ingredient — if found AND not used in the last 4 weeks → use it
2. If not found or blocked by rotation → fall back to Brave Search + Chefkoch

**Scope implies**:

- New `recipe_catalogue` table (or `is_saved` flag on `recipes` table — TBD at DISCUSS)
- New `GET /recipes` catalogue view — browse and manage saved recipes
- "Save recipe" action from recipe detail view (`GET /plan/:meal_id`)
- `GeneratePlan` lookup order changes: catalogue-first → online fallback
- Affects: Recipe Matching BC, Meal Planning BC (generation algorithm), UI

**Prerequisite**: SLICE-05 (real recipe integration) must land first — can't save what you can't view.

**Candidate slice**: SLICE-06

---

## IDEA-002: Recipe Rotation Frequency

**Captured**: 2026-07-13 (during DESIGN wave)

**Status**: ~~PROMOTED to D36~~ — now a built-in design decision, not a future idea.

4-week rotation window (`RECIPE_ROTATION_DAYS = 28`) is enforced in `GeneratePlan` via `MealPlanRepository.getRecentRecipeIds(since: Date)`. See `docs/product/architecture/brief.md` D36 and `MealPlan` aggregate invariants.

## IDEA-003: Shopping list

We need a shopping list so

The user sees all products on the Feed page. The user should be able to filter by shop, by category, by product name (filters are additive).
The discounted items should be sorted by price ascending.
The user should be able to select discounted items and add them to a shopping list.
The user should be able to add an item even if it's not discounted (i.e. the user adds an item they searched for).
The system should be able to inspire the user by being able to generate recipes based on all discounted products or from a user selection (e.g. user selects chicken and asks for recipes).
The main goal of the product is managing of groceries expenditures.
The supporting part is helping with deciding on meal plans.
