/**
 * Integration tests for PlanHandler (step 01-04).
 *
 * Tests the HTTP adapter's rendered HTML output for the D23 data attribute contract.
 */

import { describe, test, expect } from "bun:test";
import { createDb } from "../../shared/db.ts";
import { SQLiteMealPlanRepository } from "../adapters/sqlite-meal-plan-repository.ts";
import { SQLiteSavingsRepository } from "../../savings/adapters/sqlite-savings-repository.ts";
import { SavingsService } from "../../savings/savings-service.ts";
import { DiscountService } from "../../discount/discount-service.ts";
import { SQLiteDiscountItemRepository } from "../../discount/adapters/sqlite-discount-item-repository.ts";
import { PlanService } from "../plan-service.ts";
import { PlanHandler } from "./plan-handler.ts";

function buildDeps(db: ReturnType<typeof createDb>) {
  const discountItemRepo = new SQLiteDiscountItemRepository(db);
  const discountService = new DiscountService(discountItemRepo);
  const mealPlanRepo = new SQLiteMealPlanRepository(db);
  const savingsRepo = new SQLiteSavingsRepository(db);
  const savingsService = new SavingsService(savingsRepo);
  const planService = new PlanService(discountService, mealPlanRepo, savingsService, db);
  const planHandler = new PlanHandler(planService);
  return { discountService, planHandler };
}

describe("PlanHandler", () => {
  test("handlePostGenerate returns 200 (or redirect) after generating a plan", async () => {
    const db = createDb(":memory:");
    const { discountService, planHandler } = buildDeps(db);

    // Seed discount items
    await discountService.registerDiscountItem(
      { externalId: "i1", store: "Aldi", name: "Zucchini", category: "veg", regularPrice: 199, salePrice: 99, validUntil: "2026-07-14", dietaryTags: [] },
      "job-001"
    );

    const response = await planHandler.handlePostGenerate(new Request("http://localhost/plan/generate", { method: "POST" }));
    // Accept 200 or 3xx (redirect)
    expect(response.status).toBeLessThan(400);
  });

  test("handleGetPlan renders data-estimated-savings attribute in cents (integer, no decimals)", async () => {
    const db = createDb(":memory:");
    const { discountService, planHandler } = buildDeps(db);

    // Seed discount items: 199-99=100, 249-149=100, 179-89=90 → total 290 cents
    await discountService.registerDiscountItem(
      { externalId: "i1", store: "Aldi", name: "Zucchini", category: "veg", regularPrice: 199, salePrice: 99, validUntil: "2026-07-14", dietaryTags: [] },
      "job-001"
    );
    await discountService.registerDiscountItem(
      { externalId: "i2", store: "Aldi", name: "Rote Linsen", category: "legume", regularPrice: 249, salePrice: 149, validUntil: "2026-07-14", dietaryTags: [] },
      "job-001"
    );
    await discountService.registerDiscountItem(
      { externalId: "i3", store: "Aldi", name: "Spinat", category: "veg", regularPrice: 179, salePrice: 89, validUntil: "2026-07-14", dietaryTags: [] },
      "job-001"
    );

    // Generate plan first
    await planHandler.handlePostGenerate(new Request("http://localhost/plan/generate", { method: "POST" }));

    const response = await planHandler.handleGetPlan(new Request("http://localhost/plan"));
    expect(response.ok).toBe(true);

    const html = await response.text();
    // D23 contract: data attribute must be present with cents integer value
    expect(html).toMatch(/data-estimated-savings="290"/);
  });

  test("handleGetPlan renders 200 with HTML content-type", async () => {
    const db = createDb(":memory:");
    const { discountService, planHandler } = buildDeps(db);

    await discountService.registerDiscountItem(
      { externalId: "i1", store: "Aldi", name: "Zucchini", category: "veg", regularPrice: 199, salePrice: 99, validUntil: "2026-07-14", dietaryTags: [] },
      "job-001"
    );

    await planHandler.handlePostGenerate(new Request("http://localhost/plan/generate", { method: "POST" }));

    const response = await planHandler.handleGetPlan(new Request("http://localhost/plan"));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
  });
});
