/**
 * seed-discounts — direct-DB seeding helper for the meal-plan-engine acceptance suite.
 *
 * Mirrors the seeding idiom already used by multi-store.test.ts / dietary-preferences.test.ts
 * (direct Drizzle inserts into scrape_jobs + discount_items). Promoted to support/ so the
 * meal-plan-engine feature's several *.test.ts files share one seeder (SSOT / DRY).
 */

import { createDb } from "../../../src/shared/db.ts";
import { scrapeJobs, discountItems } from "../../../src/shared/schema.ts";
import { storeIdFor } from "./test-db.ts";
import { randomUUID } from "node:crypto";
import type { DiscountedProduct } from "./meal-plan-domain.ts";
import { STORE } from "./meal-plan-domain.ts";

/** ISO date N days from now (validUntil must be >= current Monday to survive getByWeek). */
export function daysFromNow(n: number): string {
  return new Date(Date.now() + n * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/** Seed a scrape_jobs row + the given discounted products, all valid for the current week. */
export function seedDiscounts(dbPath: string, products: readonly DiscountedProduct[]): void {
  const db = createDb(dbPath);
  const now = Date.now();
  const jobId = randomUUID();
  const validUntil = daysFromNow(7);

  db.insert(scrapeJobs)
    .values({
      id: jobId,
      storeId: storeIdFor(db, STORE),
      status: "completed",
      startedAt: now - 3600 * 1000,
      completedAt: now - 1800 * 1000,
      itemCount: products.length,
    })
    .run();

  for (const p of products) {
    db.insert(discountItems)
      .values({
        id: p.id,
        storeId: storeIdFor(db, STORE),
        name: p.name,
        category: "food",
        regularPrice: p.regularPriceCents,
        salePrice: p.salePriceCents,
        validUntil,
        dietaryTags: JSON.stringify(p.dietaryTags),
        scrapeJobId: jobId,
        createdAt: now,
      })
      .run();
  }
}
