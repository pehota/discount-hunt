# SLICE-04: Per-item "save €X" badge on the discount feed

**Job**: JOB-001
**Effort**: ≤0.5 day (smallest slice)
**Priority**: 4th — a quick win that reinforces the discount value at the point of first contact (the feed).
**Depends on**: none. (The save badge is a short line INSIDE a `.card`; `.card-grid` already collapses to a single column at 375px, so the badge fits regardless of the S01 nav fix. No hard dependency — this slice could ship first if desired.)

## Learning hypothesis
"The discount card shows was-price + sale-price but forces Dimitar to compute the saving himself. Showing the explicit per-item saving (`save €0.80`) makes the deal legible at a glance — matching the journey mockup."
**Disproved if**: the explicit delta adds noise without helping Dimitar rank which items are worth building meals around (the was/sale pair was already enough).

## Today (baseline)
`src/discount/http/discount-handler.ts` `renderStoreSection`: each card renders
```
<span class="was-price">was €X.XX</span>
<span class="sale-price">€Y.YY</span>
```
No explicit `save €Z` delta. Journey mockup (step 1) shows "save €0.80" per row.

## Target (delta)
Each discount card additionally shows the explicit saving amount (`regularPrice - salePrice`) as a labelled delta, consistent with the German vocabulary Dimitar uses (Angebot / Stammpreis).

## IN scope
- Add an explicit per-item saving amount to each discount card.

## OUT of scope
- Grouping, filtering, staleness warnings, empty states (all already shipped).
- Recomputing prices — the delta is `regularPrice - salePrice`, both already on the item.

## Production-data acceptance
Verified against the real running server with the current week's real discount data, at desktop AND 375px.
