/**
 * cost-objective — collocated pure-unit tests (layer 1). RED against the scaffold.
 *
 * Mandate 9: PBT full at layer 1 (fast-check). Mandate 8: pure spec -> assert return values.
 * These pin the deduped-savings invariants that keep the shipped savings_log double-count guard
 * intact (D44) and the KPI-1 spend<=baseline framing.
 */

import { describe, test, expect } from "bun:test";
import * as fc from "fast-check";
import {
  dedupedUsedProducts,
  planSpendCents,
  planRegularBaselineCents,
  type UsedProduct,
} from "./cost-objective.ts";

const productArb: fc.Arbitrary<UsedProduct> = fc
  .record({
    id: fc.string({ minLength: 1, maxLength: 6 }),
    regularPriceCents: fc.integer({ min: 2, max: 2000 }),
    delta: fc.integer({ min: 1, max: 1 }),
  })
  .map(({ id, regularPriceCents, delta }) => ({
    id,
    regularPriceCents,
    salePriceCents: Math.max(1, regularPriceCents - delta),
  }));

describe("dedupedUsedProducts — a product used by N meals counts once", () => {
  test("the deduped set has no duplicate product ids", () => {
    fc.assert(
      fc.property(fc.array(productArb, { minLength: 1, maxLength: 8 }), (catalogue) => {
        const ids = catalogue.map((p) => p.id);
        // Same product referenced by three meals.
        const perMeal = [ids, ids, ids.slice(0, 1)];
        const used = dedupedUsedProducts(perMeal, catalogue);
        const usedIds = used.map((p) => p.id);
        return new Set(usedIds).size === usedIds.length;
      }),
      { numRuns: 50 },
    );
  });
});

describe("planSpendCents / planRegularBaselineCents — spend never exceeds the regular baseline", () => {
  test("for any deduped used set, spend <= regular baseline (KPI-1)", () => {
    fc.assert(
      fc.property(fc.uniqueArray(productArb, { minLength: 1, maxLength: 8, selector: (p) => p.id }), (used) => {
        return planSpendCents(used) <= planRegularBaselineCents(used);
      }),
      { numRuns: 50 },
    );
  });

  test("spend is the sum of sale prices over the deduped set", () => {
    const used: UsedProduct[] = [
      { id: "a", regularPriceCents: 199, salePriceCents: 119 },
      { id: "b", regularPriceCents: 99, salePriceCents: 69 },
    ];
    expect(planSpendCents(used)).toBe(188);
    expect(planRegularBaselineCents(used)).toBe(298);
  });
});
