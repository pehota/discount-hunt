/**
 * ShoppingListService — domain service for the Shopping List bounded context.
 *
 * Use cases:
 *   addFromDiscountSelection(itemIds): snapshot selected weekly-feed items onto the list
 *   addManualItem(name, priceCents): add a free-text item the user typed
 *   getCurrentList(): items for the current week + running total + total savings
 *   remove(id): remove one row from the current week
 *
 * Depends on the ShoppingListRepository INTERFACE (driven port) and DiscountService.
 * Does NOT touch the Savings context — savings here are a display-only sum computed
 * from the snapshotted prices, never the persisted savings_log.
 *
 * Snapshot philosophy (write-once): discount rows copy name/store/prices AT ADD TIME
 * from the resolved StoredDiscountItem, so later feed changes never mutate the list.
 */

import { randomUUID } from "node:crypto";
import { currentWeekMonday } from "../shared/week.ts";
import type { DiscountService } from "../discount/discount-service.ts";
import type {
  ShoppingListItem,
  ShoppingListRepository,
} from "./ports/shopping-list-repository.ts";

/** Aggregated current-week view: rows plus a running total and total savings (cents). */
export interface ShoppingListSummary {
  items: ShoppingListItem[];
  totalCents: number;
  savingsCents: number;
}

export class ShoppingListService {
  constructor(
    private readonly repo: ShoppingListRepository,
    private readonly discountService: DiscountService,
  ) {}

  async addFromDiscountSelection(itemIds: string[]): Promise<void> {
    if (itemIds.length === 0) return;
    const weekStart = currentWeekMonday();
    const weeklyItems = await this.discountService.getWeeklyItems(weekStart, "none");
    const byId = new Map(weeklyItems.map((item) => [item.id, item]));

    const rows: ShoppingListItem[] = [];
    for (const id of itemIds) {
      const item = byId.get(id);
      if (item === undefined) continue;
      rows.push({
        id: randomUUID(),
        weekStart,
        source: "discount",
        name: item.name,
        store: item.store,
        salePriceCents: item.salePrice,
        regularPriceCents: item.regularPrice,
        discountItemId: item.id,
        addedAt: Date.now(),
      });
    }
    this.repo.addItems(rows);
  }

  addManualItem(name: string, priceCents: number | null): void {
    const row: ShoppingListItem = {
      id: randomUUID(),
      weekStart: currentWeekMonday(),
      source: "manual",
      name,
      store: null,
      salePriceCents: priceCents,
      regularPriceCents: null,
      discountItemId: null,
      addedAt: Date.now(),
    };
    this.repo.addItems([row]);
  }

  getCurrentList(): ShoppingListSummary {
    const items = this.repo.listByWeek(currentWeekMonday());
    let totalCents = 0;
    let savingsCents = 0;
    for (const item of items) {
      totalCents += item.salePriceCents ?? 0;
      if (item.regularPriceCents !== null && item.salePriceCents !== null) {
        savingsCents += item.regularPriceCents - item.salePriceCents;
      }
    }
    return { items, totalCents, savingsCents };
  }

  remove(id: string): void {
    this.repo.removeById(id, currentWeekMonday());
  }
}
