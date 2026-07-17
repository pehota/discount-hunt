# slice-03: cost objective — cheapest weekly shop, prefer discounts (D7)

**Story**: US-MPE-03 · **job_id**: JOB-001 (parent JOB-004) · **Order**: 3rd
**Depends on**: slice-01 · **Effort**: ~1 day

## Learning hypothesis
Assembling the plan to **minimise total € to feed the week, preferring discounted products where they are
the cheapest way** (D7) produces a plan whose spend is at/under an all-regular-price baseline — the
JOB-004 outcome.
**Disproves X if it fails**: if cost-minimising selection makes plans worse (unappetising, low recipe
coverage) or can't beat the all-regular baseline, D7's objective is wrong for this product.

## IN scope
- Product-selection step: choose recipes/products to minimise total weekly spend, preferring discounts
  where cheapest (D7). NOT max-discount-count, NOT max-€-saved-vs-regular (rejected — feature-delta D7).
- Use only the products the meals need; do not force surplus selected deals in.
- **Deduped** spend + savings over the used-product set (product used by N meals counts once); reuse the
  shipped `regular_price − sale_price` computation, same `discount_items` rows (single source).
- Plan footer: total spend + saving vs all-regular baseline.

## OUT of scope
- The recipe source/engine (slice-01). List-source (slice-02). Save→list (slice-04).
  Recording into `savings_log` beyond the existing save path (double-count guard must hold).

## Acceptance
See US-MPE-03 ACs. Key: minimise total €; no over-buying; deduped savings == shipped tracker for the
same rows; double-count guard intact; footer shows spend vs baseline.

## Dependencies / flags
- **Multi-product-per-meal deduped savings** — must not break `savings_log` double-count guard /
  replace-on-save atomicity (`src/meal-planning/plan-service.ts:100-118`). Feature-delta Architectural
  Flag 2 — DESIGN constraint.

## Carpaccio taste tests
≤1 day? Yes. · End-to-end user-visible? Yes (plan footer spend/savings; cheaper plan). · Independently
valuable? Yes (the JOB-004 cost outcome). · ≥1 non-infra story? Yes (US-MPE-03).

## Effort
~1 day — selection objective + deduped cost/savings computation (no source/UI rebuild).
