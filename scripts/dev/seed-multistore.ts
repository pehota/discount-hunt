/**
 * Dev seed — multi-store feed testing.
 *
 * Seeds a local SQLite DB with three stores at DISTINCT item counts so the
 * dashboard's per-store pill counts are visibly different. Idempotent: each
 * store's discount_items + scrape_jobs rows are cleared before re-seeding,
 * so repeated runs keep counts at 8/5/4 (not doubled).
 *
 * Run:  bun run scripts/dev/seed-multistore.ts
 *       TEST_DB_PATH=/tmp/my.db bun run scripts/dev/seed-multistore.ts
 *
 * D34: only src/{context}/adapters/sqlite-*.ts may import src/shared/schema.ts.
 * This script therefore clears rows via raw `sql` on the drizzle client instead
 * of importing table objects.
 */

import { sql } from "drizzle-orm";
import { createDb } from "../../src/shared/db.ts";
import { SQLiteDiscountItemRepository } from "../../src/discount/adapters/sqlite-discount-item-repository.ts";
import { SQLiteScrapeJobRepository } from "../../src/scraping/adapters/sqlite-scrape-job-repository.ts";
import { currentWeekMonday } from "../../src/shared/week.ts";
import type { NormalizedItem, DietaryTag } from "../../src/shared/types.ts";

const DB_PATH = process.env["TEST_DB_PATH"] ?? "/tmp/dh-multistore.db";

/** ISO "YYYY-MM-DD" a few days after the current Monday → reliably lands in this week. */
function thisWeekSunday(): string {
  const monday = new Date(`${currentWeekMonday()}T00:00:00Z`);
  monday.setUTCDate(monday.getUTCDate() + 6);
  return monday.toISOString().slice(0, 10);
}

interface StorePlan {
  store: string;
  count: number;
}

const STORE_PLANS: StorePlan[] = [
  { store: "Aldi Süd", count: 8 },
  { store: "Edeka", count: 5 },
  { store: "V-Markt", count: 4 },
];

const NAMES = [
  "Bio Haferflocken",
  "Rinderhackfleisch",
  "Lachsfilet",
  "Vollkornnudeln",
  "Tofu Natur",
  "Hähnchenbrust",
  "Sojajoghurt",
  "Feta Käse",
] as const;

const CATEGORIES = [
  "Frühstück",
  "Fleisch",
  "Fisch",
  "Nudeln",
  "Vegetarisch",
  "Fleisch",
  "Milchalternative",
  "Milchprodukte",
] as const;

const TAGS: readonly DietaryTag[] = [
  "vegan",
  "contains-meat",
  "contains-fish",
  "vegetarian",
  "vegan",
  "contains-meat",
  "vegan",
  "vegetarian",
] as const;

/** Build N varied items for a store. regularPrice always > salePrice. */
function buildItems(store: string, count: number, validUntil: string): NormalizedItem[] {
  const items: NormalizedItem[] = [];
  for (let i = 0; i < count; i++) {
    // Vary regular price and discount depth so no two items look identical.
    const regularPrice = 199 + i * 130; // cents
    const discountPct = 10 + ((i * 7) % 40); // 10%..~50%
    const salePrice = Math.max(1, Math.round(regularPrice * (1 - discountPct / 100)));
    items.push({
      externalId: `sku-${i + 1}`,
      store,
      name: `${NAMES[i % NAMES.length]} (${store})`,
      category: CATEGORIES[i % CATEGORIES.length] ?? "Sonstiges",
      regularPrice,
      salePrice,
      validUntil,
      dietaryTags: [TAGS[i % TAGS.length] ?? "unknown"],
    });
  }
  return items;
}

async function seed(): Promise<void> {
  const db = createDb(DB_PATH);
  const itemRepo = new SQLiteDiscountItemRepository(db);
  const jobRepo = new SQLiteScrapeJobRepository(db);
  const validUntil = thisWeekSunday();

  const summary: Record<string, number> = {};

  for (const { store, count } of STORE_PLANS) {
    // Idempotent clear (write-once repo would IGNORE re-inserts otherwise).
    db.run(sql`DELETE FROM discount_items WHERE store = ${store}`);
    db.run(sql`DELETE FROM scrape_jobs WHERE store = ${store}`);

    const jobId = await jobRepo.startJob(store);
    const items = buildItems(store, count, validUntil);
    for (const item of items) {
      await itemRepo.register(item, jobId);
    }
    await jobRepo.completeJob(jobId, items.length);

    summary[store] = items.length;
  }

  console.log(`Seeded multi-store feed → ${DB_PATH} (validUntil=${validUntil})`);
  for (const { store } of STORE_PLANS) {
    console.log(`  ${store}: ${summary[store]} items`);
  }
  console.log("\nLaunch the server against this DB with:");
  console.log(`  TEST_DB_PATH=${DB_PATH} bun run src/server.ts`);
}

await seed();
