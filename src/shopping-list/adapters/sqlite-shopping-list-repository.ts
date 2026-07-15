/**
 * SQLiteShoppingListRepository — secondary adapter for ShoppingListRepository.
 *
 * Table: shopping_list_items (see src/shared/schema.ts).
 * Only adapters import schema.ts (D34).
 *
 * Dedup (addItems): discount rows are skipped when their discountItemId already
 * exists for the week OR repeats earlier in the same batch. Manual rows always
 * insert. Nullable columns (store, prices, discountItemId) are mapped to explicit
 * null so bun:sqlite bindings never drop a value.
 */

import { eq, and } from "drizzle-orm";
import type { DbClient } from "../../shared/db.ts";
import { shoppingListItems } from "../../shared/schema.ts";
import type { TaxonomyCategory } from "../../shared/types.ts";
import type {
  ShoppingListItem,
  ShoppingListRepository,
} from "../ports/shopping-list-repository.ts";

export class SQLiteShoppingListRepository implements ShoppingListRepository {
  constructor(private readonly db: DbClient) {}

  addItems(rows: ShoppingListItem[]): void {
    if (rows.length === 0) return;
    for (const row of rows) {
      if (this.shouldSkip(row, this.knownDiscountIds(row.weekStart))) continue;
      this.insert(row);
    }
  }

  /**
   * Discount ids already listed for the week — computed fresh per row so a
   * duplicate inserted earlier in this same batch is seen by later rows.
   */
  private knownDiscountIds(weekStart: string): Set<string> {
    const existing = this.db
      .select({ discountItemId: shoppingListItems.discountItemId })
      .from(shoppingListItems)
      .where(eq(shoppingListItems.weekStart, weekStart))
      .all();
    const ids = new Set<string>();
    for (const row of existing) {
      if (row.discountItemId !== null) ids.add(row.discountItemId);
    }
    return ids;
  }

  private shouldSkip(row: ShoppingListItem, known: Set<string>): boolean {
    if (row.source !== "discount") return false;
    if (row.discountItemId === null) return false;
    return known.has(row.discountItemId);
  }

  private insert(row: ShoppingListItem): void {
    this.db
      .insert(shoppingListItems)
      .values({
        id: row.id,
        weekStart: row.weekStart,
        source: row.source,
        name: row.name,
        store: row.store,
        salePriceCents: row.salePriceCents,
        regularPriceCents: row.regularPriceCents,
        discountItemId: row.discountItemId,
        taxonomyCategory: row.taxonomyCategory,
        addedAt: row.addedAt,
      })
      .run();
  }

  listByWeek(weekStart: string): ShoppingListItem[] {
    const rows = this.db
      .select()
      .from(shoppingListItems)
      .where(eq(shoppingListItems.weekStart, weekStart))
      .all();
    return rows.map((row) => ({
      id: row.id,
      weekStart: row.weekStart,
      source: row.source as ShoppingListItem["source"],
      name: row.name,
      store: row.store,
      salePriceCents: row.salePriceCents,
      regularPriceCents: row.regularPriceCents,
      discountItemId: row.discountItemId,
      // Coalesce legacy NULL rows (written before this column existed) → "Other".
      taxonomyCategory: (row.taxonomyCategory ?? "Other") as TaxonomyCategory,
      addedAt: row.addedAt,
    }));
  }

  removeById(id: string, weekStart: string): void {
    this.db
      .delete(shoppingListItems)
      .where(
        and(eq(shoppingListItems.id, id), eq(shoppingListItems.weekStart, weekStart)),
      )
      .run();
  }
}
