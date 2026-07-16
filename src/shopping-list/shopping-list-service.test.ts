/**
 * Unit test for ShoppingListService — driving-port (service public API) entry,
 * asserting outcomes at the ShoppingListRepository driven-port boundary.
 *
 * DiscountService + SQLiteDiscountItemRepository are real (classical TDD inside the
 * hexagon); the shopping-list repo is real SQLite too. No mocks needed — both are
 * hexagonal-boundary adapters over in-memory SQLite.
 *
 * # bypass: these are use-case wiring/aggregation contracts (snapshot fields, skip
 * not-found ids, total/savings arithmetic) verified with representative rows — not
 * equivalence-class invariants; property-framing adds no coverage.
 *
 * Behaviors:
 *   B1: addFromDiscountSelection snapshots name/store/prices + discountItemId, skips not-found ids
 *   B2: repo dedups already-listed discount ids across calls
 *   B3: addManualItem with a price and with a null price
 *   B4: getCurrentList totals (sum sale, manual-null=0) and savings (sum regular−sale where both present)
 *   B5: remove delegates to repo.removeById for the current week
 */

import { describe, test, expect, beforeEach } from "bun:test";
import { createDb } from "../shared/db.ts";
import { SQLiteDiscountItemRepository } from "../discount/adapters/sqlite-discount-item-repository.ts";
import { DiscountService } from "../discount/discount-service.ts";
import { SQLiteShoppingListRepository } from "./adapters/sqlite-shopping-list-repository.ts";
import { ShoppingListService } from "./shopping-list-service.ts";
import { currentWeekMonday } from "../shared/week.ts";

/** validUntil inside the current week so getByWeek (validUntil >= Monday) keeps the item. */
function thisWeekValidUntil(): string {
  const monday = new Date(`${currentWeekMonday()}T00:00:00.000Z`);
  monday.setUTCDate(monday.getUTCDate() + 6);
  return monday.toISOString().slice(0, 10);
}

describe("ShoppingListService", () => {
  let service: ShoppingListService;
  let discountService: DiscountService;

  beforeEach(async () => {
    const db = createDb(":memory:");
    const discountRepo = new SQLiteDiscountItemRepository(db);
    discountService = new DiscountService(discountRepo);
    const listRepo = new SQLiteShoppingListRepository(db);
    service = new ShoppingListService(listRepo, discountService);

    await discountService.registerDiscountItem(
      {
        externalId: "z1",
        store: "aldi",
        name: "Zucchini",
        category: "vegetable",
        regularPrice: 199,
        salePrice: 99,
        validUntil: thisWeekValidUntil(),
        dietaryTags: ["vegan"],
        sourceUrl: null,
        imageUrl: null,
        brand: null,
        description: null,
      },
      "job-1",
    );
    await discountService.registerDiscountItem(
      {
        externalId: "t1",
        store: "rewe",
        name: "Tofu",
        category: "protein",
        regularPrice: 250,
        salePrice: 180,
        validUntil: thisWeekValidUntil(),
        dietaryTags: ["vegan"],
        sourceUrl: null,
        imageUrl: null,
        brand: null,
        description: null,
      },
      "job-1",
    );
  });

  test("B1: snapshots name/store/prices/discountItemId and skips not-found ids", async () => {
    await service.addFromDiscountSelection(["aldi:z1", "does-not-exist"]);

    const { items } = service.getCurrentList();
    expect(items).toHaveLength(1);
    const row = items[0]!;
    expect(row.source).toBe("discount");
    expect(row.name).toBe("Zucchini");
    expect(row.store).toBe("aldi");
    expect(row.salePriceCents).toBe(99);
    expect(row.regularPriceCents).toBe(199);
    expect(row.discountItemId).toBe("aldi:z1");
  });

  test("B1b: empty selection is a no-op", async () => {
    await service.addFromDiscountSelection([]);
    expect(service.getCurrentList().items).toHaveLength(0);
  });

  test("B2: adding an already-listed discount id is deduped by the repo", async () => {
    await service.addFromDiscountSelection(["aldi:z1"]);
    await service.addFromDiscountSelection(["aldi:z1"]);

    expect(service.getCurrentList().items).toHaveLength(1);
  });

  test("B3: addManualItem with a price and with a null price", () => {
    service.addManualItem("Bread", 149);
    service.addManualItem("Salt", null);

    const { items } = service.getCurrentList();
    expect(items).toHaveLength(2);
    const bread = items.find((i) => i.name === "Bread")!;
    const salt = items.find((i) => i.name === "Salt")!;
    expect(bread.source).toBe("manual");
    expect(bread.salePriceCents).toBe(149);
    expect(bread.store).toBeNull();
    expect(bread.regularPriceCents).toBeNull();
    expect(bread.discountItemId).toBeNull();
    expect(salt.salePriceCents).toBeNull();
  });

  test("B4: getCurrentList totals sale prices (null=0) and sums savings where both present", async () => {
    await service.addFromDiscountSelection(["aldi:z1", "rewe:t1"]); // sale 99+180, save 100+70
    service.addManualItem("Bread", 149); // sale 149, no regular → 0 savings contribution
    service.addManualItem("Salt", null); // sale 0 contribution, 0 savings

    const summary = service.getCurrentList();
    expect(summary.totalCents).toBe(99 + 180 + 149);
    expect(summary.savingsCents).toBe(100 + 70);
  });

  test("B6: count returns 0 for an empty list and N after adding N items", async () => {
    expect(service.count()).toBe(0);
    await service.addFromDiscountSelection(["aldi:z1", "rewe:t1"]);
    service.addManualItem("Bread", 149);
    expect(service.count()).toBe(3);
  });

  test("B7: addFromDiscountSelection snapshots the discount item's taxonomyCategory", async () => {
    // Zucchini's discount item is categorised "Produce" below; the row copies it.
    const db = createDb(":memory:");
    const discountRepo = new SQLiteDiscountItemRepository(db);
    const ds = new DiscountService(discountRepo);
    const listRepo = new SQLiteShoppingListRepository(db);
    const svc = new ShoppingListService(listRepo, ds);
    await ds.registerDiscountItem(
      {
        externalId: "c1", store: "aldi", name: "Carrot", category: "vegetable",
        regularPrice: 120, salePrice: 80, validUntil: thisWeekValidUntil(), dietaryTags: ["vegan"],
        sourceUrl: null,
        imageUrl: null,
        brand: null,
        description: null,
      },
      "job-c",
    );
    discountRepo.setCategorisation("aldi:c1", "Produce", []);

    await svc.addFromDiscountSelection(["aldi:c1"]);
    expect(svc.getCurrentList().items[0]!.taxonomyCategory).toBe("Produce");
  });

  test("B7b: a discount item with a null taxonomyCategory snapshots as 'Other'", async () => {
    // The seeded aldi:z1 has no taxonomy_category assigned (null) → row gets "Other".
    await service.addFromDiscountSelection(["aldi:z1"]);
    expect(service.getCurrentList().items[0]!.taxonomyCategory).toBe("Other");
  });

  test("B7c: addManualItem snapshots taxonomyCategory 'Other'", () => {
    service.addManualItem("Bread", 149);
    expect(service.getCurrentList().items[0]!.taxonomyCategory).toBe("Other");
  });

  test("B5: remove delegates to repo for the current week", async () => {
    await service.addFromDiscountSelection(["aldi:z1"]);
    const row = service.getCurrentList().items[0]!;

    service.remove(row.id);

    expect(service.getCurrentList().items).toHaveLength(0);
  });
});
