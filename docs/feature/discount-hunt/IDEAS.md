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

---

## IDEA-004: Offer history + usage statistics

**Captured**: 2026-07-16 (owner request). **Priority**: NEXT after the product-details dialog.

**Why now**: scrapes are now *replace-per-store* (a scrape DELETEs a store's rows before inserting the fresh batch — see `SQLiteDiscountItemRepository.replaceStore`). That means every re-scrape currently DISCARDS the previous offers. Before we lose more of it, archive the replaced rows so we build a longitudinal record, and start deriving behaviour/preference insights.

### Part A — Offer history table (archive-on-replace)
- New table `discount_items_history` (or `offer_history`): the discount_items columns + `archived_at` (ms) + `scrape_job_id` (+ `week_start` for convenience).
- In `replaceStore`'s transaction, BEFORE the delete: `INSERT INTO offer_history SELECT *, <archived_at>, <jobId> FROM discount_items WHERE store = ?`. Then delete + insert fresh. (One transaction, so archive+replace are atomic.)
- Retention: keep all for now (data is tiny); revisit if it grows.
- **Enables** (all from data we already scrape — no user tracking): price history per product (sale + regular over weeks) → "cheapest ever / is this actually a good deal vs usual?"; recurring-deal detection (which products cycle on sale, how often, at what price); category/store offer-volume + discount-depth trends over time; price-drop alerts (future pillar in the vision).

### Part B — Usage statistics (understand behaviour + preferences → improve UX)
Single-user personal tool → analytics is for self-understanding + product improvement, kept LOCAL (SQLite), no third-party. Build in phases:

1. **Derived-from-existing-data (no new tracking) — cheapest, do first alongside Part A.** From shopping_list_items / meal_plans / savings_log / user_settings:
   - Shopping-list composition by store / category / tag → reveals real preferences (e.g. "mostly Meat & Fish, mostly Aldi").
   - Manual vs discount add ratio; add→remove churn; list-size distribution.
   - Meal-plan generation frequency; realized savings over time (savings_log); dietary/budget settings in effect.
   - **Improves UX**: personalize feed defaults (default store/category filter to the user's favourites), surface deals in preferred categories first, tune recipe/meal suggestions.

2. **Interaction events (new lightweight tracking)** — an `events` table `{type, payload JSON, week_start, ts}` + a `POST /events` endpoint + small client beacons on: store-pill filter, category-pill filter, search terms, product-detail dialog opens (interest even without add), "view original offer" clicks, add-to-list.
   - **Improves UX**: distinguish *interest* (dialog opens / filters) from *action* (adds) → find high-interest-low-conversion categories; learn which filters/searches matter; measure feature usage.

3. **Engagement / patterns**: visits, days/times active, feature usage, scrape-freshness vs visit timing → overall usage & behaviour patterns.

4. **Insights view + preference-driven UX**: a `/insights` (or Settings) dashboard summarizing A + B; then act on inferred preferences (personalized defaults, "good deal" badges powered by offer history).

**Build order**: Part A (offer-history archive-on-replace) + Part B.1 (derived stats) first — high value, no tracking infra. Then B.2 (event logging) → B.3/B.4 (dashboard + personalization).

**Prerequisite**: product-details dialog ships first (owner's stated order).
