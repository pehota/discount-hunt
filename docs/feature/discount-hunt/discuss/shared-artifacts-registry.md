# Shared Artifacts Registry — discount-hunt

<!-- markdownlint-disable MD024 -->

Tracks every data value that appears in multiple journey steps. Each artifact has one source of truth.

---

## regular_price

**Source of truth**: `discount_items.regular_price` (captured at scrape time)
**Owner**: scraper module
**Integration risk**: CRITICAL — if regular_price is not captured at scrape time, savings comparisons become impossible after the promotional period ends. Must never be derived from current store pricing.
**Consumers**:
- Step 1 (Discount Feed): displayed as "was €X.XX" next to sale price
- Step 2 (Meal Plan footer): used in SUM(regular_price - sale_price) for estimated_savings
- Step 4 (Savings Tracker): used in "would have paid €X.XX" comparison
**Validation**: `regular_price IS NOT NULL AND regular_price > sale_price` for every discount item row

---

## sale_price

**Source of truth**: `discount_items.sale_price` (captured at scrape time)
**Owner**: scraper module
**Integration risk**: HIGH — must match what the store is actually advertising; stale sale_price is misleading
**Consumers**:
- Step 1 (Discount Feed): displayed as the primary price
- Step 2 (Meal Plan): shown next to highlighted ingredient
- Step 4 (Savings Tracker): "total paid" figure
**Validation**: `sale_price > 0 AND sale_price < regular_price`

---

## dietary_filter

**Source of truth**: `user_settings.dietary_restrictions` (single-row table)
**Owner**: settings module
**Integration risk**: HIGH — if dietary_filter is applied inconsistently between plan generation and recipe view, non-compliant meals can slip through
**Consumers**:
- Step 2 (Meal Plan generation): filter applied BEFORE item selection
- Step 2 (Discount Dashboard): items incompatible with restriction hidden or flagged
- Step 3 (Recipe View): ingredient list shown only for compliant recipes
**Validation**: restriction applied identically in all 3 consumers; no consumer derives restriction independently

---

## estimated_savings

**Source of truth**: computed at plan-generation time as `SUM(regular_price - sale_price)` for discounted items in the current plan
**Owner**: meal plan service
**Integration risk**: MEDIUM — must match the savings_log entry for the same week; inconsistency breaks user trust
**Consumers**:
- Step 2 (Meal Plan footer): "Estimated savings this week: €X.XX"
- Step 4 (Savings Tracker): "SAVED: €X.XX" for current week
**Validation**: `savings_log.saved_amount` for current week equals estimated_savings computed at plan generation

---

## refresh_timestamp

**Source of truth**: `scrape_jobs.last_successful_run` (per store)
**Owner**: scraper scheduler
**Integration risk**: LOW — display-only; staleness warning logic is the key consumer
**Consumers**:
- Step 1 (Discount Dashboard header): "Last refreshed: Mon 06:00"
- Step 1 (Staleness warning): if `now() - last_successful_run > 48h` → show warning banner
**Validation**: timestamp is updated only on successful scrape completion, not on scrape attempt

---

## meal_plan

**Source of truth**: `meal_plans` table (`plan_id`, `week_start`, `meals` JSON array)
**Owner**: meal plan service
**Integration risk**: MEDIUM — recipe detail view derives meal_id from plan; orphaned plan entries break recipe navigation
**Consumers**:
- Step 2 (Meal Plan view): full 7-day display
- Step 3 (Recipe Detail): `meal_id` from plan links to recipe
- Step 4 (Savings Tracker): `plan_id` links to `savings_log` week
**Validation**: every meal in `meals` JSON has a `meal_id` that either resolves to a recipe or renders a no-recipe fallback

---

## recipe_link

**Source of truth**: `recipes` table (`recipe_id`, `title`, `source_url`, `ingredients` JSON, `cached_content`)
**Owner**: recipe service
**Integration risk**: MEDIUM — source_url can become stale (404); cached_content must be populated at recipe-creation time
**Consumers**:
- Step 3 (Recipe Detail view): ingredient list, steps, source URL
**Validation**: `cached_content IS NOT NULL` for every recipe row; `source_url` checked for 404 before display, fallback to cached_content

---

## Integration Checkpoints

| Checkpoint | What to Verify | Risk |
|-----------|----------------|------|
| scraper → DB | `regular_price` AND `sale_price` both populated for each item | CRITICAL |
| DB → plan generator | dietary_filter sourced from `user_settings`, not hardcoded | HIGH |
| plan generator → savings_log | `estimated_savings` written to `savings_log.saved_amount` at plan-save time | MEDIUM |
| savings_log → savings view | `regular_price` baseline still present even after promotion ends | CRITICAL |
| plan → recipe view | `meal_id` in plan JSON resolves in `recipes` table (or fallback is shown) | MEDIUM |
