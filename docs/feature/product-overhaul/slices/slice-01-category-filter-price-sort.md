# SLICE-01: Additive category filter + cheapest-first sort

**Job**: JOB-004 (primary), JOB-001 (supporting)
**Status**: NEW scope (extends the in-flight store-filter/name-search work)
**Effort**: ≤1 day
**Priority**: 2nd overall — low-risk additive quick win that sharpens the feed for the whole reframe. Sequenced right after the shopping-list core (SLICE-02) because SLICE-02 validates the reframe and this makes the feed that feeds it usable.
**Depends on**: the in-flight product-name search + store-filter pills landing on `main` (additive-filter contract). Soft dependency only — can be built against the existing store-filter pills.

## Learning hypothesis
"Narrowing the feed by category (as a THIRD additive filter alongside store + name) and sorting discounts cheapest-first lets Dimitar find the good deals fast enough to assemble a list without scrolling the whole feed."
**Disproved if**: category adds no discriminating power (too few categories, or items mostly land in 'Uncategorised'), or cheapest-first is not the order Dimitar actually wants to scan in.

## Today (baseline)
Feed groups discounts by store with store filter pills (shipped) and product-name search (in-flight). No category dimension; no explicit price sort control. Discount items carry `regular_price`, `sale_price`, `store` — **no `category` field is confirmed to exist** (see OQ-PO-2).

## Target (delta)
- A category filter (dropdown or pills) that combines ADDITIVELY with the existing store filter and name search (store AND category AND name — never replace).
- Discounted items sorted by `sale_price` ascending by default.

## IN scope
- Category as a third additive filter on the feed.
- Price-ascending sort of the discounted feed.
- 'Uncategorised' bucket for items with no derivable category (no item is dropped).

## OUT of scope
- Any change to what is scraped/stored EXCEPT deriving a `category` (see prerequisite).
- Sorting the meal plan or savings views.

## Prerequisite / open question
**OQ-PO-2**: does a `category` exist on `discount_items`? If not, this slice needs a thin
normalizer-level category derivation (from the catalogue's own product type/label) as its first task.
If category cannot be reliably derived, the slice degrades to price-sort-only + a documented gap.

## Acceptance (from journey step 1 Gherkin)
- Additive filter combination (store AND category AND name) returns only items matching all active filters; clearing one keeps the others.
- Discounted items render in ascending `sale_price` order by default.
- Zero-match filter combo shows "No items match these filters" + clear-filters affordance.

## Production-data acceptance
Verified on the running server with a real multi-store week (use `scripts/dev/seed-multistore.ts`), desktop and 375px.
