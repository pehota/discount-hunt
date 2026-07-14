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
import * as fc from "fast-check";
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

// ─── PBT: generatePlan meal structure (step 02-04) ───────────────────────────

/**
 * Fast-check unit tests for generatePlan() 14-meal structure.
 *
 * Behaviors under test (Mandate 1 budget: 2 × 2 behaviors = 4 max; using 2):
 *   B1: given non-empty items, all 14 slots filled by cycling items (no empty slot)
 *   B2: given 0 items, all 14 meals have discountItemId null and placeholder name
 *
 * Entry through the driving port: PlanService.generatePlan() public API.
 */
describe("PlanService.generatePlan — 14-meal structure (PBT)", () => {
  const itemStrategy = fc.record({
    id: fc.uuid(),
    store: fc.constant("Aldi"),
    name: fc.string({ minLength: 1, maxLength: 20 }),
    category: fc.constant("vegetable"),
    regularPrice: fc.integer({ min: 100, max: 500 }),
    salePrice: fc.integer({ min: 50, max: 99 }),
    validUntil: fc.constant("2026-07-20"),
    dietaryTags: fc.constant([]),
    scrapeJobId: fc.constant("job-pbt"),
    createdAt: fc.constant(0),
  });

  test("B1: given 1-20 discount items, generatePlan produces exactly 14 meals all filled via cycling", () => {
    const db = createDb(":memory:");
    const { planService } = buildServices(db);

    fc.assert(
      fc.property(fc.array(itemStrategy, { minLength: 1, maxLength: 20 }), (items) => {
        const plan = planService.generatePlan(TEST_WEEK, items);

        // Exactly 14 meal slots
        if (plan.meals.length !== 14) return false;

        // All slots filled (no null discountItemId when items available)
        if (plan.meals.some((m) => m.discountItemId === null)) return false;

        // Items cycled: slot i picks items[i % items.length]
        for (let i = 0; i < 14; i++) {
          const expected = items[i % items.length];
          if (plan.meals[i].discountItemId !== expected.id) return false;
          if (plan.meals[i].name !== expected.name) return false;
        }

        // Day range 1-7, alternating slots
        for (let i = 0; i < 14; i++) {
          const day = Math.floor(i / 2) + 1;
          const slot = i % 2 === 0 ? "lunch" : "dinner";
          if (plan.meals[i].day !== day) return false;
          if (plan.meals[i].slot !== slot) return false;
        }

        return true;
      }),
      { numRuns: 50 }
    );
  });

  test("B2: given 0 discount items, generatePlan produces 14 meals with null discountItemId and placeholder name", () => {
    const db = createDb(":memory:");
    const { planService } = buildServices(db);

    const plan = planService.generatePlan(TEST_WEEK, []);

    expect(plan.meals).toHaveLength(14);
    for (const meal of plan.meals) {
      expect(meal.discountItemId).toBeNull();
      expect(meal.name).toBe("No discount available");
    }
  });
});
