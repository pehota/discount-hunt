/**
 * Integration tests for PlanHandler (step 01-04).
 *
 * Tests the HTTP adapter's rendered HTML output for the D23 data attribute contract.
 */

import { describe, test, expect } from "bun:test";
import { eq } from "drizzle-orm";
import { createDb } from "../../shared/db.ts";
import { mealPlans, savingsLog, discountItems } from "../../shared/schema.ts";
import { SQLiteMealPlanRepository } from "../adapters/sqlite-meal-plan-repository.ts";
import { SQLiteSavingsRepository } from "../../savings/adapters/sqlite-savings-repository.ts";
import { SavingsService } from "../../savings/savings-service.ts";
import { DiscountService } from "../../discount/discount-service.ts";
import { SQLiteDiscountItemRepository } from "../../discount/adapters/sqlite-discount-item-repository.ts";
import { PlanService } from "../plan-service.ts";
import { PlanHandler } from "./plan-handler.ts";
import { currentWeekMonday } from "../../shared/week.ts";

/** A validUntil comfortably inside the current week so getByWeek keeps the item. */
function thisWeekValidUntil(): string {
  const monday = new Date(`${currentWeekMonday()}T00:00:00.000Z`);
  monday.setUTCDate(monday.getUTCDate() + 6); // that week's Sunday
  return monday.toISOString().slice(0, 10);
}

function urlEncodedPost(body: string): Request {
  return new Request("http://localhost/plan/generate", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
}

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
      { externalId: "i1", store: "Aldi", name: "Zucchini", category: "veg", regularPrice: 199, salePrice: 99, validUntil: "2026-07-14", dietaryTags: [], sourceUrl: null, imageUrl: null, brand: null, description: null },
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
      { externalId: "i1", store: "Aldi", name: "Zucchini", category: "veg", regularPrice: 199, salePrice: 99, validUntil: "2026-07-14", dietaryTags: [], sourceUrl: null, imageUrl: null, brand: null, description: null },
      "job-001"
    );
    await discountService.registerDiscountItem(
      { externalId: "i2", store: "Aldi", name: "Rote Linsen", category: "legume", regularPrice: 249, salePrice: 149, validUntil: "2026-07-14", dietaryTags: [], sourceUrl: null, imageUrl: null, brand: null, description: null },
      "job-001"
    );
    await discountService.registerDiscountItem(
      { externalId: "i3", store: "Aldi", name: "Spinat", category: "veg", regularPrice: 179, salePrice: 89, validUntil: "2026-07-14", dietaryTags: [], sourceUrl: null, imageUrl: null, brand: null, description: null },
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

  test("handleGetPlan surfaces the store + sale price behind each meal (live-feed lookup)", async () => {
    const db = createDb(":memory:");
    const { discountService, planHandler } = buildDeps(db);

    // Distinctive store name + sale price so we can assert they surface per meal.
    await discountService.registerDiscountItem(
      { externalId: "i1", store: "Netto Marken", name: "Zucchini", category: "veg", regularPrice: 199, salePrice: 99, validUntil: "2026-07-14", dietaryTags: [], sourceUrl: null, imageUrl: null, brand: null, description: null },
      "job-001"
    );

    await planHandler.handlePostGenerate(new Request("http://localhost/plan/generate", { method: "POST" }));

    const html = await (await planHandler.handleGetPlan(new Request("http://localhost/plan"))).text();
    // Store name and sale price (€0.99) are shown against the meal driven by that item.
    expect(html).toContain("Netto Marken");
    expect(html).toMatch(/data-label="Price"[\s\S]*?0\.99/);
  });

  test("empty selection → inline 200, NO persisted plan, existing plan preserved", async () => {
    const db = createDb(":memory:");
    const { discountService, planHandler } = buildDeps(db);
    const week = currentWeekMonday();
    const vu = thisWeekValidUntil();

    await discountService.registerDiscountItem(
      { externalId: "i1", store: "Aldi", name: "Zucchini", category: "veg", regularPrice: 199, salePrice: 99, validUntil: vu, dietaryTags: [], sourceUrl: null, imageUrl: null, brand: null, description: null },
      "job-001",
    );

    // Seed a good existing plan for the week (via full selection) first.
    const items = db.select().from(discountItems).all();
    await planHandler.handlePostGenerate(
      urlEncodedPost(items.map((i) => `itemIds=${i.id}`).join("&")),
    );
    const before = db.select().from(mealPlans).where(eq(mealPlans.weekStart, week)).all();
    expect(before).toHaveLength(1);
    const existingId = before[0]!.id;

    // Now POST with NO itemIds (empty selection).
    const response = await planHandler.handlePostGenerate(urlEncodedPost("other=x"));

    expect(response.status).toBe(200); // inline, NOT a redirect
    const html = await response.text();
    expect(html).toContain("No products selected");

    // The good plan is NOT wiped, no new row added.
    const after = db.select().from(mealPlans).where(eq(mealPlans.weekStart, week)).all();
    expect(after).toHaveLength(1);
    expect(after[0]!.id).toBe(existingId);
  });

  test("generate-from-selection happy path: only selected items counted", async () => {
    const db = createDb(":memory:");
    const { discountService, planHandler } = buildDeps(db);
    const week = currentWeekMonday();
    const vu = thisWeekValidUntil();

    await discountService.registerDiscountItem(
      { externalId: "i1", store: "Aldi", name: "Zucchini", category: "veg", regularPrice: 199, salePrice: 99, validUntil: vu, dietaryTags: [], sourceUrl: null, imageUrl: null, brand: null, description: null },
      "job-001",
    );
    await discountService.registerDiscountItem(
      { externalId: "i2", store: "Aldi", name: "Rote Linsen", category: "legume", regularPrice: 249, salePrice: 149, validUntil: vu, dietaryTags: [], sourceUrl: null, imageUrl: null, brand: null, description: null },
      "job-001",
    );
    await discountService.registerDiscountItem(
      { externalId: "i3", store: "Aldi", name: "Spinat", category: "veg", regularPrice: 179, salePrice: 89, validUntil: vu, dietaryTags: [], sourceUrl: null, imageUrl: null, brand: null, description: null },
      "job-001",
    );

    const rows = db.select().from(discountItems).all();
    const chosen = [rows[0]!, rows[2]!]; // 100 + 90 = 190
    const chosenIds = chosen.map((r) => r.id);

    const response = await planHandler.handlePostGenerate(
      urlEncodedPost(chosenIds.map((id) => `itemIds=${id}`).join("&")),
    );
    expect(response.status).toBeLessThan(400); // redirect

    const planRows = db.select().from(mealPlans).where(eq(mealPlans.weekStart, week)).all();
    expect(planRows).toHaveLength(1);
    expect(JSON.parse(planRows[0]!.itemIds) as string[]).toEqual(chosenIds);
    expect(planRows[0]!.estimatedSavings).toBe(190);

    const savingsRows = db.select().from(savingsLog).where(eq(savingsLog.weekStart, week)).all();
    expect(savingsRows).toHaveLength(1);
    expect(savingsRows[0]!.savedAmount).toBe(190);
  });

  test("handleGetPlan renders 200 with HTML content-type", async () => {
    const db = createDb(":memory:");
    const { discountService, planHandler } = buildDeps(db);

    await discountService.registerDiscountItem(
      { externalId: "i1", store: "Aldi", name: "Zucchini", category: "veg", regularPrice: 199, salePrice: 99, validUntil: "2026-07-14", dietaryTags: [], sourceUrl: null, imageUrl: null, brand: null, description: null },
      "job-001"
    );

    await planHandler.handlePostGenerate(new Request("http://localhost/plan/generate", { method: "POST" }));

    const response = await planHandler.handleGetPlan(new Request("http://localhost/plan"));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
  });
});
