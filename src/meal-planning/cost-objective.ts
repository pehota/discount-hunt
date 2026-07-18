/**
 * cost-objective — RED scaffold (created by DISTILL, meal-plan-engine US-MPE-03 / D7).
 *
 * Pure functions (D38 effect boundary: these live in the pure core, no I/O):
 *  - `dedupedUsedProducts`: the DEDUPED set of discounted products a plan's meals actually use
 *    (a product used by N meals counts once) — the input set for spend/savings so the shipped
 *    savings_log double-count guard is not broken (D44).
 *  - `planSpendCents` / `planRegularBaselineCents`: total sale spend vs the all-regular-price
 *    baseline over the deduped used set (footer figures + KPI-1).
 *
 * These are collocated-PBT-tested at layer 1 (fast-check). The cost-minimising SELECTION itself is
 * exercised at the acceptance layer (HTTP) where the candidate set is assembled by the shell.
 */

export const __SCAFFOLD__ = true;

export interface UsedProduct {
  readonly id: string;
  readonly regularPriceCents: number;
  readonly salePriceCents: number;
}

/** The deduped set of products referenced across the plan's meals (each product once). */
export function dedupedUsedProducts(
  perMealProductIds: readonly (readonly string[])[],
  catalogue: readonly UsedProduct[],
): UsedProduct[] {
  throw new Error("Not yet implemented — RED scaffold");
}

/** Total sale-price spend over the deduped used products (cents). */
export function planSpendCents(used: readonly UsedProduct[]): number {
  throw new Error("Not yet implemented — RED scaffold");
}

/** All-regular-price baseline over the deduped used products (cents). */
export function planRegularBaselineCents(used: readonly UsedProduct[]): number {
  throw new Error("Not yet implemented — RED scaffold");
}
