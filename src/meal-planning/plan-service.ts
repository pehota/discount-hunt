/**
 * PlanService — core domain service for the Meal Planning bounded context.
 *
 * Use cases (D37 plan-value pattern):
 *   generatePlan(weekStart, discountItems): MealPlan — pure computation; no DB writes
 *   savePlan(plan): void                            — only impure function; writes meal_plans +
 *                                                     savings_log in ONE SQLite transaction (D23)
 *
 * Invariants:
 *   - estimated_savings = SUM(regularPrice - salePrice) for all discount items
 *   - savePlan writes both meal_plans.estimated_savings and savings_log.saved_amount in same transaction (D23)
 *   - getOrGenerateCurrentWeekPlan: idempotent — returns existing plan if one exists for current week
 *
 * Driven ports: SQLiteMealPlanRepository, DiscountService, SavingsService, DbClient
 */

import { randomUUID } from "node:crypto";
import type { DbClient } from "../shared/db.ts";
import type { WeekStart, Meal, MealSlot, DietaryRestriction } from "../shared/types.ts";
import { currentWeekMonday } from "../shared/week.ts";
import type { DiscountService } from "../discount/discount-service.ts";
import type { StoredDiscountItem } from "../discount/adapters/sqlite-discount-item-repository.ts";
import type { SQLiteMealPlanRepository, MealPlan } from "./adapters/sqlite-meal-plan-repository.ts";
import type { SavingsService } from "../savings/savings-service.ts";
import type { UserPreferencesRepository } from "../preferences/ports/preferences-repository.ts";

const MEAL_SLOTS: MealSlot[] = ['lunch', 'dinner'];
const DAYS_PER_WEEK = 7;
const NO_DISCOUNT_PLACEHOLDER = 'No discount available';

export class PlanService {
  constructor(
    private readonly discountService: DiscountService,
    private readonly mealPlanRepository: SQLiteMealPlanRepository,
    private readonly savingsService: SavingsService,
    private readonly db: DbClient,
    private readonly preferencesRepository?: UserPreferencesRepository,
  ) {}

  /** Pure computation — no DB writes (D37). Snapshots the restriction + budget cap onto the plan. */
  generatePlan(
    weekStart: WeekStart,
    discountItems: StoredDiscountItem[],
    dietaryFilter: DietaryRestriction = "none",
    budgetCapCents: number | null = null,
  ): MealPlan {
    const totalRegularPrice = discountItems.reduce((sum, item) => sum + item.regularPrice, 0);
    const totalSalePrice = discountItems.reduce((sum, item) => sum + item.salePrice, 0);
    const estimatedSavings = totalRegularPrice - totalSalePrice;

    return {
      id: randomUUID(),
      weekStart,
      itemIds: discountItems.map((item) => item.id),
      meals: this.buildMeals(discountItems),
      dietaryFilter,
      budgetCapCents, // snapshotted at generation; frozen for this week's plan (D25)
      totalRegularPrice,
      totalSalePrice,
      estimatedSavings,
      createdAt: Date.now(),
    };
  }

  private buildMeals(discountItems: StoredDiscountItem[]): Meal[] {
    const meals: Meal[] = [];
    for (let day = 1; day <= DAYS_PER_WEEK; day++) {
      MEAL_SLOTS.forEach((slot, slotIdx) => {
        meals.push(this.buildMealSlot(day, slot, slotIdx, discountItems));
      });
    }
    return meals;
  }

  private buildMealSlot(day: number, slot: MealSlot, slotIdx: number, discountItems: StoredDiscountItem[]): Meal {
    if (discountItems.length === 0) {
      return { day, slot, name: NO_DISCOUNT_PLACEHOLDER, discountItemId: null };
    }
    const slotIndex = (day - 1) * MEAL_SLOTS.length + slotIdx;
    const item = discountItems[slotIndex % discountItems.length];
    if (!item) {
      // Unreachable: modulo over a non-empty array always yields a valid index.
      throw new Error("buildMealSlot: index out of range");
    }
    return { day, slot, name: item.name, discountItemId: item.id };
  }

  /**
   * Only impure function (D37).
   * Writes meal_plans AND savings_log in ONE SQLite transaction (D23).
   *
   * drizzle-orm/bun-sqlite uses a synchronous driver — db.transaction() callback
   * is synchronous. Repository methods (save, recordSavings) are therefore sync.
   */
  async savePlan(plan: MealPlan): Promise<void> {
    // drizzle-orm/bun-sqlite uses a synchronous SQLite driver.
    // The repositories share this db reference — all writes in the callback
    // execute inside the same bun:sqlite transaction (connection-scoped).
    // _tx is unused directly; repos call this.db internally.
    this.db.transaction((_tx) => {
      this.mealPlanRepository.save(plan);
      // D23: same cents value written to both tables atomically
      this.savingsService.recordSavings(
        plan.id,
        plan.estimatedSavings,
        plan.totalSalePrice,
        plan.totalRegularPrice,
        plan.itemIds.length,
        plan.weekStart,
      );
    });
  }

  /**
   * Read-only current-week plan lookup — NO generate, NO save (contrast with
   * getOrGenerateCurrentWeekPlan). The recipe detail route (GET /plan/{meal_id})
   * needs to locate an existing meal without mutating any state: resolving a recipe
   * must never trigger plan generation or a savings_log write.
   */
  getCurrentWeekPlan(): MealPlan | null {
    return this.mealPlanRepository.findByWeek(currentWeekMonday());
  }

  async getOrGenerateCurrentWeekPlan(): Promise<MealPlan> {
    const weekStart = currentWeekMonday();
    const existing = this.mealPlanRepository.findByWeek(weekStart);
    if (existing) return existing;

    const preferences = this.preferencesRepository?.get();
    const restriction = preferences?.dietaryRestriction ?? "none";
    const budgetCapCents = preferences?.budgetCapCents ?? null;
    const items = await this.discountService.getWeeklyItems(weekStart, restriction);
    const plan = this.generatePlan(weekStart, items, restriction, budgetCapCents);
    // Do NOT persist ANY empty plan, regardless of restriction. An empty plan is a transient
    // "couldn't build one" signal, never a durable weekly commitment. Persisting it makes
    // get-or-create return it forever, so compatible discounts arriving later stay hidden and a
    // bogus 0-savings row is written (bug 07-01 / 07-02). Leaving it unsaved makes it non-sticky —
    // the next read re-queries with the current restriction and surfaces newly-arrived items.
    // Non-empty plans ARE persisted: they are durable weekly commitments, frozen until next week
    // (03-08 D2 snapshot immutability). Split is exactly items.length === 0.
    if (items.length > 0) {
      await this.savePlan(plan);
    }
    return plan;
  }
}
