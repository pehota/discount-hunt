/**
 * Integration tests for PlanService (step 01-04).
 *
 * Tests enter through the driving ports (PlanService public methods) and
 * assert outcomes at driven-port boundaries (DB state via real SQLite).
 *
 * Coverage:
 *   a. PlanService.generatePlan + savePlan: seed discount items, call both, verify DB rows
 *   b. D23 invariant: meal_plans.estimated_savings == savings_log.saved_amount
 *   c. getOrGenerateCurrentWeekPlan: idempotency (no duplicate rows on second call)
 */

import { describe, test, expect, beforeEach } from "bun:test";
import { createDb } from "../shared/db.ts";
import { discountItems, mealPlans, savingsLog } from "../shared/schema.ts";
import { SQLiteMealPlanRepository } from "./adapters/sqlite-meal-plan-repository.ts";
import { SQLiteSavingsRepository } from "../savings/adapters/sqlite-savings-repository.ts";
import { SavingsService } from "../savings/savings-service.ts";
import { DiscountService } from "../discount/discount-service.ts";
import { SQLiteDiscountItemRepository } from "../discount/adapters/sqlite-discount-item-repository.ts";
import { PlanService } from "./plan-service.ts";
import type { WeekStart } from "../shared/types.ts";

const TEST_WEEK: WeekStart = "2026-07-13";

const SEED_ITEMS = [
  {
    externalId: "item-001",
    store: "Aldi",
    name: "Zucchini",
    category: "vegetable",
    regularPrice: 199, // cents
    salePrice: 99,
    validUntil: "2026-07-14",
    dietaryTags: [] as const,
  },
  {
    externalId: "item-002",
    store: "Aldi",
    name: "Rote Linsen",
    category: "legume",
    regularPrice: 249,
    salePrice: 149,
    validUntil: "2026-07-14",
    dietaryTags: [] as const,
  },
  {
    externalId: "item-003",
    store: "Aldi",
    name: "Spinat",
    category: "vegetable",
    regularPrice: 179,
    salePrice: 89,
    validUntil: "2026-07-14",
    dietaryTags: [] as const,
  },
];

// Expected savings: (199-99) + (249-149) + (179-89) = 100 + 100 + 90 = 290 cents
const EXPECTED_SAVINGS = 290;

function buildServices(db: ReturnType<typeof createDb>) {
  const discountItemRepo = new SQLiteDiscountItemRepository(db);
  const discountService = new DiscountService(discountItemRepo);
  const mealPlanRepo = new SQLiteMealPlanRepository(db);
  const savingsRepo = new SQLiteSavingsRepository(db);
  const savingsService = new SavingsService(savingsRepo);
  const planService = new PlanService(discountService, mealPlanRepo, savingsService, db);
  return { discountService, planService, mealPlanRepo, savingsRepo };
}

describe("PlanService", () => {
  let db: ReturnType<typeof createDb>;

  beforeEach(() => {
    db = createDb(":memory:");
    // Seed discount items into DB
    const discountItemRepo = new SQLiteDiscountItemRepository(db);
    const discountService = new DiscountService(discountItemRepo);
    for (const item of SEED_ITEMS) {
      discountService.registerDiscountItem(
        {
          externalId: item.externalId,
          store: item.store,
          name: item.name,
          category: item.category,
          regularPrice: item.regularPrice,
          salePrice: item.salePrice,
          validUntil: item.validUntil,
          dietaryTags: [],
        },
        "scrape-job-001"
      );
    }
  });

  test("generatePlan returns a MealPlan value with estimatedSavings computed from discount items", () => {
    const { discountService, mealPlanRepo, savingsRepo } = buildServices(db);
    const savingsService = new SavingsService(savingsRepo);
    const planService = new PlanService(discountService, mealPlanRepo, savingsService, db);

    // bypass: pure function test, single return value
    const items = db.select().from(discountItems).all();
    const storedItems = items.map((row) => ({
      id: row.id,
      store: row.store,
      name: row.name,
      category: row.category,
      regularPrice: row.regularPrice,
      salePrice: row.salePrice,
      validUntil: row.validUntil,
      dietaryTags: JSON.parse(row.dietaryTags),
      scrapeJobId: row.scrapeJobId,
      createdAt: row.createdAt,
    }));

    const plan = planService.generatePlan(TEST_WEEK, storedItems);

    expect(plan.weekStart).toBe(TEST_WEEK);
    expect(plan.estimatedSavings).toBe(EXPECTED_SAVINGS);
    expect(plan.itemIds).toHaveLength(3);
    expect(plan.totalRegularPrice).toBe(199 + 249 + 179); // 627
    expect(plan.totalSalePrice).toBe(99 + 149 + 89);     // 337
  });

  test("savePlan writes meal_plans row in DB", async () => {
    const { planService } = buildServices(db);
    const items = db.select().from(discountItems).all();
    const storedItems = items.map((row) => ({
      id: row.id,
      store: row.store,
      name: row.name,
      category: row.category,
      regularPrice: row.regularPrice,
      salePrice: row.salePrice,
      validUntil: row.validUntil,
      dietaryTags: JSON.parse(row.dietaryTags),
      scrapeJobId: row.scrapeJobId,
      createdAt: row.createdAt,
    }));

    const plan = planService.generatePlan(TEST_WEEK, storedItems);
    await planService.savePlan(plan);

    const planRows = db.select().from(mealPlans).all();
    expect(planRows).toHaveLength(1);
    expect(planRows[0].weekStart).toBe(TEST_WEEK);
    expect(planRows[0].estimatedSavings).toBe(EXPECTED_SAVINGS);
  });

  test("D23 invariant: meal_plans.estimated_savings equals savings_log.saved_amount (written in one transaction)", async () => {
    const { planService } = buildServices(db);
    const items = db.select().from(discountItems).all();
    const storedItems = items.map((row) => ({
      id: row.id,
      store: row.store,
      name: row.name,
      category: row.category,
      regularPrice: row.regularPrice,
      salePrice: row.salePrice,
      validUntil: row.validUntil,
      dietaryTags: JSON.parse(row.dietaryTags),
      scrapeJobId: row.scrapeJobId,
      createdAt: row.createdAt,
    }));

    const plan = planService.generatePlan(TEST_WEEK, storedItems);
    await planService.savePlan(plan);

    const planRows = db.select().from(mealPlans).all();
    const savingsRows = db.select().from(savingsLog).all();

    expect(planRows).toHaveLength(1);
    expect(savingsRows).toHaveLength(1);

    // D23 structural guarantee: both values must be equal
    expect(planRows[0].estimatedSavings).toBe(savingsRows[0].savedAmount);
    expect(savingsRows[0].savedAmount).toBe(EXPECTED_SAVINGS);
    expect(savingsRows[0].planId).toBe(planRows[0].id);
  });

  test("getOrGenerateCurrentWeekPlan generates and persists a plan when none exists", async () => {
    const { planService } = buildServices(db);

    const plan = await planService.getOrGenerateCurrentWeekPlan();

    expect(plan.estimatedSavings).toBe(EXPECTED_SAVINGS);

    const planRows = db.select().from(mealPlans).all();
    const savingsRows = db.select().from(savingsLog).all();
    expect(planRows).toHaveLength(1);
    expect(savingsRows).toHaveLength(1);
  });

  test("getOrGenerateCurrentWeekPlan returns existing plan without creating duplicates on second call", async () => {
    const { planService } = buildServices(db);

    await planService.getOrGenerateCurrentWeekPlan();
    await planService.getOrGenerateCurrentWeekPlan();

    const planRows = db.select().from(mealPlans).all();
    const savingsRows = db.select().from(savingsLog).all();
    expect(planRows).toHaveLength(1);
    expect(savingsRows).toHaveLength(1);
  });
});
