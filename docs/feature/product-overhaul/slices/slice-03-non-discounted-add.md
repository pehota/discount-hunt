# SLICE-03: Add a non-discounted item to the list (manual/staple)

**Job**: JOB-004 (primary)
**Status**: NEW scope
**Effort**: ≤1 day
**Priority**: 3rd overall — completes the "whole shop" promise (deals + staples in one costed list). Sequenced after SLICE-02 (needs the persisted list to add into).
**Depends on**: SLICE-02 (persisted list). SOFT dependency on the in-flight product-name search (the "search yielded no discount → add anyway" entry point rides on the search). If search has not landed, the manual add is reachable via a plain "add item" affordance on the list.

## Learning hypothesis
"Letting Dimitar add items he needs but that are NOT on sale (staples like milk/eggs) makes the list represent the WHOLE shop and its true cost — not just the deals — which is what makes the running total trustworthy for budget decisions."
**Disproved if**: Dimitar only ever wants discounted items on the list and treats staples separately anyway.

## Today (baseline)
No list exists before SLICE-02; and even then, list items reference `discount_items`. There is no way to represent an item the app never scraped. The scraper stores ONLY items with both regular+sale price (~20% of catalogue, D21) — there is no full product catalogue to look a staple up in.

## Target (delta) — CHEAP reading (see OQ-PO-1)
- A manual list row: free-text name + OPTIONAL manual price + optional quantity.
- Manual rows contribute their price to the running total when a price is given.
- Manual rows WITHOUT a price are added, marked "price unknown", excluded from the numeric total, and surfaced as "+N items without a price" so the total is honest, never silently understated.

## IN scope
- Free-text manual item add with optional price.
- Honest-total handling of price-unknown manual items.
- Entry point from a "no discount found — add anyway?" prompt when name-search yields nothing (rides the in-flight search; degrades to a direct "add item" button if search is absent).

## OUT of scope
- Looking a non-discounted item up against a full product catalogue (that is the EXPENSIVE reading — a backend expansion; see OQ-PO-1). NOT built here.
- Price auto-fill / price history for manual items.

## Prerequisite / open question
**OQ-PO-1** (surfaced to user as #1 open question): "Add a non-discounted item" has two readings —
(a) CHEAP: free-text manual entry with optional user-typed price (this slice); (b) EXPENSIVE: lookup
against a full scraped catalogue the app does not currently maintain. This slice implements (a).
If the user wants (b), it is a separate backend-prerequisite slice (full-catalogue scraping) — flagged, not built.

## Acceptance (from journey step 2 Gherkin, manual subset)
- Searching for a staple with no discount offers "add it anyway"; entering a price adds it and includes the price in the total.
- A manual item added with no price is marked "price unknown", the total is unchanged, and a "+N items without a price" note appears.

## Production-data acceptance
Verified on the running server: add a real staple (e.g. "Vollmilch 1L") with and without a price; confirm honest total behaviour at desktop and 375px.
