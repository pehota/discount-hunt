/**
 * ShoppingListRepository — driven port for the Shopping List bounded context.
 *
 * A write+read+delete CRUD port scoped by week. Rows are added from two sources:
 * discount selections (snapshotted from the weekly feed) and manual entries.
 *
 * Dedup policy lives in addItems (adapter implements it): incoming discount rows
 * whose discountItemId already exists for the week — or repeats within the same
 * batch — are skipped. Manual rows always insert (no natural key).
 *
 * Nullable columns are typed `T | null` (NOT optional `?`) so inserts pass explicit
 * null and Drizzle's sql binding never drops a value silently (exactOptionalPropertyTypes).
 */

import type { TaxonomyCategory } from "../../shared/types.ts";

/** A shopping-list row. Prices/store/category snapshotted at add time (write-once). */
export interface ShoppingListItem {
  id: string;
  weekStart: string;
  source: "discount" | "manual";
  name: string;
  store: string | null;
  salePriceCents: number | null;
  regularPriceCents: number | null;
  discountItemId: string | null;
  /** Snapshotted taxonomy bucket (write-once). Always concrete — legacy NULL rows read back as "Other". */
  taxonomyCategory: TaxonomyCategory;
  addedAt: number;
}

export interface ShoppingListRepository {
  /**
   * Adds rows for the week. Discount rows are deduped by discountItemId
   * (against existing rows AND within this batch); manual rows always insert.
   */
  addItems(rows: ShoppingListItem[]): void;
  /** Returns all rows for the given week (insertion order). */
  listByWeek(weekStart: string): ShoppingListItem[];
  /** Removes a single row by id, scoped to the week. Absent id is a no-op. */
  removeById(id: string, weekStart: string): void;
}
