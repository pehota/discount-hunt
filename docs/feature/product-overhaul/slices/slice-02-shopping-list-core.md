# SLICE-02: Shopping-list core (select → persisted list + running total)

**Job**: JOB-004 (primary)
**Status**: NEW scope — the keystone of the reframe. Builds on the in-flight cross-store SELECTION OVERVIEW panel (persists its transient state).
**Effort**: ≤1 day (thin: discounted-item adds only; manual/non-discounted add is SLICE-03)
**Priority**: 1st overall — HIGHEST learning leverage. This slice validates the entire IA reframe: does a persisted, running-total shopping list actually deliver "know the shop's cost before the till"? Everything else is refinement on top of this.
**Depends on**: the in-flight selection overview panel landing (selection state exists to persist). Reuses discount_items as the price source.

## Learning hypothesis
"Turning the transient cross-store selection into a PERSISTED shopping list with a live running total gives Dimitar the forward spend number JOB-004 exists for — he knows what the shop costs before leaving."
**Disproved if**: the running total is not the thing Dimitar looks at (e.g. he only cares about per-item savings, not basket cost), or persistence adds no value over the transient selection.

## Today (baseline)
Selection = per-card checkboxes feeding the meal-plan generator; an in-flight cross-store selection OVERVIEW panel shows the current selection transiently. Nothing persists as a distinct shopping list; there is no running total of "the shop I'm about to make". Meal-plan is the only destination for a selection.

## Target (delta)
- A persisted `shopping_list` / `shopping_list_items` artifact (survives sessions within the week).
- "+ Add" from a discounted feed item creates a list row referencing `discount_items` (price = `sale_price`, single source, write-once like D22).
- A running total (`SUM(sale_price*qty)`) shown on the list and as a feed badge ("Shopping List (N) — €X.XX").
- Remove item / adjust quantity re-derives the total. Duplicate add increments qty.
- List reuses the JOB-002 `regular_price - sale_price` computation to also show list-level savings (single source; must not diverge from the shipped savings tracker).

## IN scope
- Persisted list of DISCOUNTED items with running total + list-level savings.
- Selection→list persistence (the overview panel's state becomes durable).
- Preserve the existing selection→Generate-meal-plan flow (D-decision): selection now fans out to (list | plan), plan mechanics unchanged.

## OUT of scope
- Non-discounted / manual item add (SLICE-03).
- Recipe inspiration from the list (SLICE-04).
- Category filter / price sort (SLICE-01).

## Acceptance (from journey steps 2–3 Gherkin, discounted-item subset)
- Adding a discounted item creates a list row with its store + sale price; total increases by that price.
- Removing an item updates the total immediately.
- The list and its items persist across sessions within the week.
- List-level savings uses the same computation and rows as the shipped savings tracker (no divergent number).
- The existing selection→Generate-meal-plan flow still works (savings dedup guard intact).

## Production-data acceptance
Verified on the running server: build a list from a real multi-store week, close + reopen, confirm persistence and correct running total at desktop and 375px.
