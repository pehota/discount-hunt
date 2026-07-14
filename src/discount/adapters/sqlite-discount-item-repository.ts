/**
 * SQLiteDiscountItemRepository — secondary adapter implementing DiscountItemRepository port.
 *
 * Table: discount_items (see src/shared/schema.ts)
 * Commands: register, getByWeek
 *
 * Invariants enforced at insert:
 *   - regular_price IS NOT NULL (D22)
 *   - regular_price > sale_price (D22 write-once; id derived from store:externalId so
 *     duplicate scrapes do NOT overwrite regular_price — first-write wins)
 *
 * D22: id = "${store}:${externalId}" ensures idempotent writes across scrape runs.
 * INSERT OR IGNORE preserves regular_price on conflict (write-once).
 */

import { sql, gte } from "drizzle-orm";
import type { DbClient } from "../../shared/db.ts";
import { discountItems } from "../../shared/schema.ts";
import { isCompatible } from "../../shared/dietary.ts";
import type { NormalizedItem, WeekStart, DietaryRestriction, DietaryTag } from "../../shared/types.ts";

export interface StoredDiscountItem {
  id: string;
  store: string;
  name: string;
  category: string;
  regularPrice: number;
  salePrice: number;
  validUntil: string;
  dietaryTags: DietaryTag[];
  scrapeJobId: string;
  createdAt: number;
}

export class SQLiteDiscountItemRepository {
  constructor(private readonly db: DbClient) {}

  async register(item: NormalizedItem, scrapeJobId: string): Promise<void> {
    const id = `${item.store}:${item.externalId}`;
    // INSERT OR IGNORE — D22 write-once: regular_price not overwritten on conflict
    this.db.run(sql`
      INSERT OR IGNORE INTO discount_items
        (id, store, name, category, regular_price, sale_price, valid_until, dietary_tags, scrape_job_id, created_at)
      VALUES
        (${id}, ${item.store}, ${item.name}, ${item.category},
         ${item.regularPrice}, ${item.salePrice}, ${item.validUntil},
         ${JSON.stringify(item.dietaryTags)}, ${scrapeJobId}, ${Date.now()})
    `);
  }

  async getByWeek(weekStart: WeekStart, restriction: DietaryRestriction): Promise<StoredDiscountItem[]> {
    const rows = this.db.select().from(discountItems)
      .where(gte(discountItems.validUntil, weekStart))
      .all();
    return rows
      .filter((row) => {
        const tags = JSON.parse(row.dietaryTags) as DietaryTag[];
        return isCompatible(tags, restriction);
      })
      .map((row) => ({
        id: row.id,
        store: row.store,
        name: row.name,
        category: row.category,
        regularPrice: row.regularPrice,
        salePrice: row.salePrice,
        validUntil: row.validUntil,
        dietaryTags: JSON.parse(row.dietaryTags) as DietaryTag[],
        scrapeJobId: row.scrapeJobId,
        createdAt: row.createdAt,
      }));
  }
}
