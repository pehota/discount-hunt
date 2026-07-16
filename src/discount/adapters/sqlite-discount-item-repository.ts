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

import { sql, gte, isNull, eq } from "drizzle-orm";
import type { DbClient } from "../../shared/db.ts";
import { discountItems } from "../../shared/schema.ts";
import { isCompatible } from "../../shared/dietary.ts";
import type { NormalizedItem, WeekStart, DietaryRestriction, DietaryTag, TaxonomyCategory, Tag } from "../../shared/types.ts";
import { isTag } from "../../shared/types.ts";
import type { DiscountCategoryStore } from "../../categorisation/ports.ts";

export interface StoredDiscountItem {
  id: string;
  store: string;
  name: string;
  category: string;
  regularPrice: number;
  salePrice: number;
  validUntil: string;
  dietaryTags: DietaryTag[];
  tags: Tag[];
  taxonomyCategory: TaxonomyCategory | null;
  sourceUrl: string | null;
  scrapeJobId: string;
  createdAt: number;
}

export class SQLiteDiscountItemRepository implements DiscountCategoryStore {
  constructor(private readonly db: DbClient) {}

  async register(item: NormalizedItem, scrapeJobId: string): Promise<void> {
    this.insertRow(item, scrapeJobId);
  }

  /**
   * Replace-per-store: atomically delete ALL rows for `store` (old/stale too)
   * and insert the fresh batch. SYNC — bun-sqlite drizzle transactions wrap only
   * synchronous writes on the same connection; an async callback would silently
   * skip rollback. Delete binds the passed `store` param, not item.store.
   */
  replaceStore(store: string, items: NormalizedItem[], scrapeJobId: string): void {
    this.db.transaction(() => {
      this.db.run(sql`DELETE FROM discount_items WHERE store = ${store}`);
      for (const item of items) this.insertRow(item, scrapeJobId);
    });
  }

  /** Single writer of the discount_items INSERT — shared by register + replaceStore. */
  private insertRow(item: NormalizedItem, scrapeJobId: string): void {
    // Defense-in-depth: an undefined interpolation makes Drizzle's `sql`
    // template silently drop the binding, emitting malformed SQL. Fail loudly
    // with the offending field name so future schema drift is diagnosable.
    this.assertNoUndefinedField(item, scrapeJobId);

    const id = `${item.store}:${item.externalId}`;
    // INSERT OR IGNORE — D22 write-once: regular_price not overwritten on conflict
    this.db.run(sql`
      INSERT OR IGNORE INTO discount_items
        (id, store, name, category, regular_price, sale_price, valid_until, dietary_tags, source_url, scrape_job_id, created_at)
      VALUES
        (${id}, ${item.store}, ${item.name}, ${item.category},
         ${item.regularPrice}, ${item.salePrice}, ${item.validUntil},
         ${JSON.stringify(item.dietaryTags)}, ${item.sourceUrl}, ${scrapeJobId}, ${Date.now()})
    `);
  }

  private assertNoUndefinedField(item: NormalizedItem, scrapeJobId: string): void {
    const bindings: Record<string, unknown> = {
      externalId: item.externalId,
      store: item.store,
      name: item.name,
      category: item.category,
      regularPrice: item.regularPrice,
      salePrice: item.salePrice,
      validUntil: item.validUntil,
      dietaryTags: item.dietaryTags,
      sourceUrl: item.sourceUrl,
      scrapeJobId,
    };
    for (const [field, value] of Object.entries(bindings)) {
      if (value === undefined) {
        throw new Error(`register: field '${field}' is undefined`);
      }
    }
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
        tags: this.parseTags(row.tags),
        taxonomyCategory: row.taxonomyCategory as TaxonomyCategory | null,
        sourceUrl: row.sourceUrl,
        scrapeJobId: row.scrapeJobId,
        createdAt: row.createdAt,
      }));
  }

  // ── DiscountCategoryStore port (single writer of discount_items) ────────────

  /**
   * Uncategorised rows (taxonomy_category IS NULL) for the categorisation run.
   * NAMING REMAP: the DB `category` column holds the raw German productType; it
   * is surfaced under the port field `productType`. taxonomy_category is the
   * OUTPUT column and is never read as input here.
   */
  findUncategorised(): { id: string; name: string; productType: string }[] {
    const rows = this.db.select({
      id: discountItems.id,
      name: discountItems.name,
      productType: discountItems.category,
    })
      .from(discountItems)
      .where(isNull(discountItems.taxonomyCategory))
      .all();
    return rows;
  }

  /** Persist the classified bucket AND cross-cutting tags for one item. */
  setCategorisation(id: string, category: TaxonomyCategory, tags: Tag[]): void {
    this.db.update(discountItems)
      .set({ taxonomyCategory: category, tags: JSON.stringify(tags) })
      .where(eq(discountItems.id, id))
      .run();
  }

  /**
   * Parse the stored tags JSON into a validated Tag[]. Defaults to [] on any
   * parse error / non-array, and filters out anything that is not a known Tag.
   */
  private parseTags(raw: string): Tag[] {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return [];
    }
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter((v): v is Tag => typeof v === "string" && isTag(v));
  }
}
