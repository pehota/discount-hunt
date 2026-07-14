/**
 * Unit/integration test for DiscountHandler.handleGet
 *
 * Uses real SQLite in-memory DB (classical TDD integration pattern at hexagonal boundary).
 * DiscountService + SQLiteDiscountItemRepository are real — no mocks in the domain.
 * Test doubles would only appear at external port boundaries; none needed here.
 *
 * Behaviors under test (Mandate 1: 2 × 2 behaviors = 4 max; we use 2):
 *   B1: items present → HTML contains names and both prices per item + Generate Meal Plan button
 *   B2: no items → HTML contains "No discounts available this week" + Generate Meal Plan button
 */

import { describe, test, expect, beforeEach } from "bun:test";
import { createDb } from "../../shared/db.ts";
import { SQLiteDiscountItemRepository } from "../adapters/sqlite-discount-item-repository.ts";
import { DiscountService } from "../discount-service.ts";
import { DiscountHandler } from "./discount-handler.ts";

function makeRequest(): Request {
  return new Request("http://localhost/");
}

describe("DiscountHandler.handleGet", () => {
  let handler: DiscountHandler;
  let discountService: DiscountService;

  beforeEach(() => {
    const db = createDb(":memory:");
    const repo = new SQLiteDiscountItemRepository(db);
    discountService = new DiscountService(repo);
    handler = new DiscountHandler(discountService);
  });

  test("B1: returns 200 HTML with item names and both prices when items exist", async () => {
    // Seed fixture mirroring walking-skeleton AT happy path
    await discountService.registerDiscountItem(
      {
        externalId: "item-001",
        store: "aldi",
        name: "Zucchini",
        category: "vegetable",
        regularPrice: 199, // cents
        salePrice: 99,     // cents
        validUntil: "2026-07-14",
        dietaryTags: ["vegan"],
      },
      "job-001"
    );
    await discountService.registerDiscountItem(
      {
        externalId: "item-002",
        store: "aldi",
        name: "Rote Linsen",
        category: "legume",
        regularPrice: 249,
        salePrice: 149,
        validUntil: "2026-07-14",
        dietaryTags: ["vegan"],
      },
      "job-001"
    );
    await discountService.registerDiscountItem(
      {
        externalId: "item-003",
        store: "aldi",
        name: "Spinat",
        category: "vegetable",
        regularPrice: 179,
        salePrice: 89,
        validUntil: "2026-07-14",
        dietaryTags: ["vegan"],
      },
      "job-001"
    );

    const response = await handler.handleGet(makeRequest());

    expect(response.status).toBe(200);
    const html = await response.text();

    // Item names
    expect(html).toContain("Zucchini");
    expect(html).toContain("Rote Linsen");
    expect(html).toContain("Spinat");

    // Both prices per item (cents → euros, 2 decimal places)
    expect(html).toContain("1.99"); // Zucchini regularPrice
    expect(html).toContain("0.99"); // Zucchini salePrice
    expect(html).toContain("2.49"); // Rote Linsen regularPrice
    expect(html).toContain("1.49"); // Rote Linsen salePrice
    expect(html).toContain("1.79"); // Spinat regularPrice
    expect(html).toContain("0.89"); // Spinat salePrice

    // No empty-state message
    expect(html).not.toContain("No discounts available this week");

    // Generate Meal Plan button always visible (US-01 AC)
    expect(html).toContain("Generate Meal Plan");
  });

  test("B2: returns 200 HTML with empty-state message and Generate Meal Plan button when no items exist", async () => {
    // No items seeded — empty DB

    const response = await handler.handleGet(makeRequest());

    expect(response.status).toBe(200);
    const html = await response.text();

    expect(html).toContain("No discounts available this week");
    expect(html).toContain("Generate Meal Plan");
  });
});
