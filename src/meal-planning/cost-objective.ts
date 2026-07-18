/**
 * cost-objective — pure core (meal-plan-engine US-MPE-03 / D7).
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

export interface UsedProduct {
  readonly id: string;
  readonly regularPriceCents: number;
  readonly salePriceCents: number;
}

/** The deduped set of products referenced across the plan's meals (each product once, first-seen order). */
export function dedupedUsedProducts(
  perMealProductIds: readonly (readonly string[])[],
  catalogue: readonly UsedProduct[],
): UsedProduct[] {
  const byId = new Map(catalogue.map((product) => [product.id, product]));
  const seen = new Set<string>();
  const used: UsedProduct[] = [];
  for (const meal of perMealProductIds) {
    for (const id of meal) {
      if (seen.has(id)) continue;
      const product = byId.get(id);
      if (product === undefined) continue;
      seen.add(id);
      used.push(product);
    }
  }
  return used;
}

/** Total sale-price spend over the deduped used products (cents). */
export function planSpendCents(used: readonly UsedProduct[]): number {
  return used.reduce((sum, product) => sum + product.salePriceCents, 0);
}

/** All-regular-price baseline over the deduped used products (cents). */
export function planRegularBaselineCents(used: readonly UsedProduct[]): number {
  return used.reduce((sum, product) => sum + product.regularPriceCents, 0);
}
