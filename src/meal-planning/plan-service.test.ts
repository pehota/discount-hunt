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
import { eq, getTableColumns } from "drizzle-orm";
import { createDb } from "../shared/db.ts";
import { discountItems, stores, mealPlans, savingsLog } from "../shared/schema.ts";
import { SQLiteMealPlanRepository } from "./adapters/sqlite-meal-plan-repository.ts";
import { SQLiteSavingsRepository } from "../savings/adapters/sqlite-savings-repository.ts";
import { SavingsService } from "../savings/savings-service.ts";
import { DiscountService } from "../discount/discount-service.ts";
import { SQLiteDiscountItemRepository, type StoredDiscountItem } from "../discount/adapters/sqlite-discount-item-repository.ts";
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

/**
 * Raw discount_items rows with the store NAME re-joined in (name-at-boundary):
 * the schema stores a store_id FK, so `.store` no longer lives on the row.
 * innerJoin(stores) surfaces stores.name as `store`, matching StoredDiscountItem.
 */
function selectDiscountRows(db: ReturnType<typeof createDb>) {
  return db
    .select({ ...getTableColumns(discountItems), store: stores.name })
    .from(discountItems)
    .innerJoin(stores, eq(discountItems.storeId, stores.id))
    .all();
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
          sourceUrl: null,
          imageUrl: null,
          brand: null,
          description: null,
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
    const items = selectDiscountRows(db);
    const storedItems = items.map((row) => ({
      id: row.id,
      store: row.store,
      name: row.name,
      category: row.category,
      regularPrice: row.regularPrice,
      salePrice: row.salePrice,
      validUntil: row.validUntil,
      dietaryTags: JSON.parse(row.dietaryTags),
      tags: [],
      taxonomyCategory: row.taxonomyCategory as StoredDiscountItem["taxonomyCategory"],
      sourceUrl: row.sourceUrl,
      imageUrl: row.imageUrl,
      brand: row.brand,
      description: row.description,
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
    const items = selectDiscountRows(db);
    const storedItems = items.map((row) => ({
      id: row.id,
      store: row.store,
      name: row.name,
      category: row.category,
      regularPrice: row.regularPrice,
      salePrice: row.salePrice,
      validUntil: row.validUntil,
      dietaryTags: JSON.parse(row.dietaryTags),
      tags: [],
      taxonomyCategory: row.taxonomyCategory as StoredDiscountItem["taxonomyCategory"],
      sourceUrl: row.sourceUrl,
      imageUrl: row.imageUrl,
      brand: row.brand,
      description: row.description,
      scrapeJobId: row.scrapeJobId,
      createdAt: row.createdAt,
    }));

    const plan = planService.generatePlan(TEST_WEEK, storedItems);
    await planService.savePlan(plan);

    const planRows = db.select().from(mealPlans).all();
    expect(planRows).toHaveLength(1);
    expect(planRows[0]!.weekStart).toBe(TEST_WEEK);
    expect(planRows[0]!.estimatedSavings).toBe(EXPECTED_SAVINGS);
  });

  test("D23 invariant: meal_plans.estimated_savings equals savings_log.saved_amount (written in one transaction)", async () => {
    const { planService } = buildServices(db);
    const items = selectDiscountRows(db);
    const storedItems = items.map((row) => ({
      id: row.id,
      store: row.store,
      name: row.name,
      category: row.category,
      regularPrice: row.regularPrice,
      salePrice: row.salePrice,
      validUntil: row.validUntil,
      dietaryTags: JSON.parse(row.dietaryTags),
      tags: [],
      taxonomyCategory: row.taxonomyCategory as StoredDiscountItem["taxonomyCategory"],
      sourceUrl: row.sourceUrl,
      imageUrl: row.imageUrl,
      brand: row.brand,
      description: row.description,
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
    expect(planRows[0]!.estimatedSavings).toBe(savingsRows[0]!.savedAmount);
    expect(savingsRows[0]!.savedAmount).toBe(EXPECTED_SAVINGS);
    expect(savingsRows[0]!.planId).toBe(planRows[0]!.id);
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

// ─── Generate-from-selection + no-double-count (SLICE feature) ───────────────

describe("PlanService — generate from a user-selected subset", () => {
  let db: ReturnType<typeof createDb>;

  beforeEach(() => {
    db = createDb(":memory:");
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
          sourceUrl: null,
          imageUrl: null,
          brand: null,
          description: null,
        },
        "scrape-job-001",
      );
    }
  });

  function storedItems() {
    return selectDiscountRows(db).map((row) => ({
      id: row.id,
      store: row.store,
      name: row.name,
      category: row.category,
      regularPrice: row.regularPrice,
      salePrice: row.salePrice,
      validUntil: row.validUntil,
      dietaryTags: JSON.parse(row.dietaryTags),
      tags: [],
      taxonomyCategory: row.taxonomyCategory as StoredDiscountItem["taxonomyCategory"],
      sourceUrl: row.sourceUrl,
      imageUrl: row.imageUrl,
      brand: row.brand,
      description: row.description,
      scrapeJobId: row.scrapeJobId,
      createdAt: row.createdAt,
    }));
  }

  // Regression guard (already satisfied by the pure generatePlan): a chosen subset
  // drives itemIds, per-meal ids and estimatedSavings — nothing outside the subset.
  test("generatePlan over a 3-item subset counts ONLY the subset", () => {
    const { planService } = buildServices(db);
    const all = storedItems();
    const subset = [all[0]!, all[2]!]; // Zucchini (100) + Spinat (90) = 190
    const subsetIds = new Set(subset.map((i) => i.id));

    const plan = planService.generatePlan(TEST_WEEK, subset);

    expect(plan.itemIds).toEqual(subset.map((i) => i.id)); // order preserved
    expect(plan.estimatedSavings).toBe(190);
    for (const meal of plan.meals) {
      if (meal.discountItemId !== null) {
        expect(subsetIds.has(meal.discountItemId)).toBe(true);
      }
    }
  });

  // THE LANDMINE: regenerating the SAME week with a DIFFERENT subset must REPLACE,
  // never double-count. Exactly one savings_log row + one meal_plans row for the week,
  // carrying subset B's value (the new one — not summed, not stale A).
  test("regenerating the same week REPLACES and never double-counts savings", async () => {
    const { planService } = buildServices(db);
    const all = storedItems();

    // Subset A: item[1] only → 249-149 = 100
    const planA = planService.generatePlan(TEST_WEEK, [all[1]!]);
    await planService.savePlan(planA);

    // Subset B: item[0] + item[2] → 100 + 90 = 190 (different ids + value)
    const planB = planService.generatePlan(TEST_WEEK, [all[0]!, all[2]!]);
    await planService.savePlan(planB);

    const savingsRows = db
      .select()
      .from(savingsLog)
      .where(eq(savingsLog.weekStart, TEST_WEEK))
      .all();
    expect(savingsRows).toHaveLength(1);
    expect(savingsRows[0]!.savedAmount).toBe(190); // B's value, not 100 nor 290
    expect(savingsRows[0]!.planId).toBe(planB.id);

    const planRows = db
      .select()
      .from(mealPlans)
      .where(eq(mealPlans.weekStart, TEST_WEEK))
      .all();
    expect(planRows).toHaveLength(1);
    expect(planRows[0]!.id).toBe(planB.id);
    expect(planRows[0]!.estimatedSavings).toBe(190);
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
    tags: fc.constant([]),
    taxonomyCategory: fc.constant(null),
    sourceUrl: fc.constant(null),
    imageUrl: fc.constant(null),
    brand: fc.constant(null),
    description: fc.constant(null),
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
          const expected = items[i % items.length]!;
          if (plan.meals[i]!.discountItemId !== expected.id) return false;
          if (plan.meals[i]!.name !== expected.name) return false;
        }

        // Day range 1-7, alternating slots
        for (let i = 0; i < 14; i++) {
          const day = Math.floor(i / 2) + 1;
          const slot = i % 2 === 0 ? "lunch" : "dinner";
          if (plan.meals[i]!.day !== day) return false;
          if (plan.meals[i]!.slot !== slot) return false;
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
