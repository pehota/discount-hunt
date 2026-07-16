/**
 * DiscountService unit tests — delegation to the driven repository port.
 *
 * bypass: interaction/wiring test over a spy repo — verifies the service forwards
 * the exact (store, items, scrapeJobId) tuple to replaceStore, not a generative
 * invariant.
 */

import { describe, test, expect } from "bun:test";
import { DiscountService } from "./discount-service.ts";
import type { SQLiteDiscountItemRepository } from "./adapters/sqlite-discount-item-repository.ts";
import type { NormalizedItem } from "../shared/types.ts";

describe("DiscountService.replaceStoreItems", () => {
  test("delegates to repo.replaceStore with the exact (store, items, scrapeJobId) args", async () => {
    const calls: { store: string; items: NormalizedItem[]; scrapeJobId: string }[] = [];
    const fakeRepo = {
      replaceStore(store: string, items: NormalizedItem[], scrapeJobId: string): void {
        calls.push({ store, items, scrapeJobId });
      },
    } as unknown as SQLiteDiscountItemRepository;

    const service = new DiscountService(fakeRepo);

    const items: NormalizedItem[] = [
      {
        externalId: "a",
        store: "Aldi Süd",
        name: "Item a",
        category: "test",
        regularPrice: 200,
        salePrice: 150,
        validUntil: "2026-07-20",
        dietaryTags: [],
        sourceUrl: null,
      },
    ];

    await service.replaceStoreItems("Aldi Süd", items, "job-1");

    expect(calls.length).toBe(1);
    expect(calls[0]!.store).toBe("Aldi Süd");
    expect(calls[0]!.items).toBe(items);
    expect(calls[0]!.scrapeJobId).toBe("job-1");
  });
});
