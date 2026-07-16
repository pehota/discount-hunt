/**
 * DiscountService — domain service for the Discount/Pricing bounded context.
 *
 * Use cases:
 *   RegisterDiscountItem(normalizedItem, scrapeJobId): validates price invariants, persists
 *   GetWeeklyItems(weekStart, restriction): returns StoredDiscountItem[] filtered by isCompatible()
 *
 * Invariants enforced:
 *   - regularPrice must be > salePrice (D22)
 *
 * Driven ports: SQLiteDiscountItemRepository
 */

import type { NormalizedItem, WeekStart, DietaryRestriction, TaxonomyCategory, Tag } from "../shared/types.ts";
import type { SQLiteDiscountItemRepository, StoredDiscountItem } from "./adapters/sqlite-discount-item-repository.ts";

export class DiscountService {
  constructor(private readonly discountItemRepository: SQLiteDiscountItemRepository) {}

  async registerDiscountItem(item: NormalizedItem, scrapeJobId: string): Promise<void> {
    await this.discountItemRepository.register(item, scrapeJobId);
  }

  async replaceStoreItems(
    store: string,
    items: NormalizedItem[],
    scrapeJobId: string,
    classifications?: { category: TaxonomyCategory; tags: Tag[] }[],
  ): Promise<void> {
    this.discountItemRepository.replaceStore(store, items, scrapeJobId, classifications);
  }

  async getWeeklyItems(weekStart: WeekStart, restriction: DietaryRestriction = "none"): Promise<StoredDiscountItem[]> {
    return this.discountItemRepository.getByWeek(weekStart, restriction);
  }
}
