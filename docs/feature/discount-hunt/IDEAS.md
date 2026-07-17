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

## IDEA-004: Categorise before swapping in new discounts (staged replace)

**Captured**: 2026-07-16 (owner request). **Priority**: before IDEA-005 (offer history).

**Problem**: today `replaceStore` DELETEs a store's old rows and INSERTs the fresh batch in one txn, and categorisation runs *after* the whole scrape completes. Between the swap and the end of categorisation, the freshly-inserted items carry NULL `taxonomy_category` → the feed shows them all in "Other" with no category chips/filters. Every re-scrape briefly loses the categorised view. (Observed 2026-07-16: 342 items sat uncategorised until the LLM pass finished.)

**Want**: keep the OLD, already-categorised discounts live until the NEW batch is fully categorised, then swap atomically — no "Other"-everything window.

**Sketch**:
- Scrape into a staging area (a `pending`/`draft` flag on the new rows, or a separate staging table) — NOT directly over the live rows.
- Categorise the staged batch.
- Only once the staged batch is fully categorised (0 NULL taxonomy) does an atomic promote replace the live store rows with the staged batch (one txn) — mirroring today's replace-per-store atomicity.
- If categorisation fails or is partial, keep the old live rows (graceful — never downgrade the live feed).
- Composes with IDEA-005: the archive-on-replace step happens at the atomic promote, not at scrape time.

---

## IDEA-005: Offer history + usage statistics

**Captured**: 2026-07-16 (owner request). **Priority**: NEXT after the product-details dialog.

**Why now**: scrapes are now *replace-per-store* (a scrape DELETEs a store's rows before inserting the fresh batch — see `SQLiteDiscountItemRepository.replaceStore`). That means every re-scrape currently DISCARDS the previous offers. Before we lose more of it, archive the replaced rows so we build a longitudinal record, and start deriving behaviour/preference insights.

### Part A — Offer history table (archive-on-replace) — ✅ SHIPPED (2026-07-17, commit `aa49ff7`)
Implemented as the `offer_history` table (surrogate `history_id` PK + `item_id` = original discount_items.id, since the id repeats weekly; mirrors all discount_items columns + `archived_at` (ms) + `week_start` (`currentWeekMonday()` SSOT); `store_id` FK → stores(id); indexes on store_id + item_id). `replaceStore` archives the store's live rows via `INSERT ... SELECT` as the first statement inside its transaction, before the DELETE (archive+replace atomic; old rows' `scrape_job_id`/`created_at` preserved for provenance). Retention: keep all (tiny). Verified end-to-end on a real-DB copy: a re-scrape of Aldi archived the 32 prior offers with archived_at/week_start set.
- **Now enables** (all from data we already scrape — no user tracking): price history per product (`item_id` over weeks) → "cheapest ever / good deal vs usual?"; recurring-deal detection; category/store offer-volume + discount-depth trends; price-drop alerts (future vision pillar). These are the natural next builds once Part B.1 lands.

### Part B — Usage statistics (SUGGESTIONS ONLY — owner to approve before any build)

> Status 2026-07-17: **NOT started — no code.** Owner directive: Part B is suggestions only. Part A (offer_history) has shipped, so B.1 below can already join it for "good deal vs usual" answers. Single-user, local (SQLite), no third-party. Phased cheapest/highest-value first; each phase gated on the prior proving worth acting on.
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

**Build order** (recommended): **B.1 first** (derived-from-existing-data + offer_history — pure read model, zero new schema, immediately useful; ship as a compact `/insights` summary, not a dashboard) → **B.2** (events table, only once B.1 proves the insights are worth acting on) → **B.3 / B.4** (engagement patterns + preference-driven UX: default filters to favourites, "good deal" badges powered by offer_history price stats).

**Open questions for the owner (blockers before building B.2+):**
- Is a new `events` tracking table wanted at all, or should insights stay purely derived (B.1 only)?
- Any privacy line even for a local single-user tool?
- Which personalization is most wanted first — default feed filters (store/category → favourites), or "good deal" badges from offer_history price history?
