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
import type { WeekStart } from "../shared/types.ts";
import type { DiscountService } from "../discount/discount-service.ts";
import type { StoredDiscountItem } from "../discount/adapters/sqlite-discount-item-repository.ts";
import type { SQLiteMealPlanRepository, MealPlan } from "./adapters/sqlite-meal-plan-repository.ts";
import type { SavingsService } from "../savings/savings-service.ts";

/**
 * Returns the ISO date string for the Monday of the current UTC week.
 * Sunday (day=0) rolls back 6 days; other days offset by (1 - day).
 */
function currentMonday(): WeekStart {
  const now = new Date();
  const day = now.getUTCDay(); // 0=Sun … 6=Sat
  const offsetToMonday = day === 0 ? -6 : 1 - day;
  const monday = new Date(now);
  monday.setUTCDate(now.getUTCDate() + offsetToMonday);
  return monday.toISOString().slice(0, 10); // "YYYY-MM-DD"
}

export class PlanService {
  constructor(
    private readonly discountService: DiscountService,
    private readonly mealPlanRepository: SQLiteMealPlanRepository,
    private readonly savingsService: SavingsService,
    private readonly db: DbClient,
  ) {}

  /** Pure computation — no DB writes (D37). */
  generatePlan(weekStart: WeekStart, discountItems: StoredDiscountItem[]): MealPlan {
    const totalRegularPrice = discountItems.reduce((sum, item) => sum + item.regularPrice, 0);
    const totalSalePrice = discountItems.reduce((sum, item) => sum + item.salePrice, 0);
    const estimatedSavings = totalRegularPrice - totalSalePrice;

    return {
      id: randomUUID(),
      weekStart,
      itemIds: discountItems.map((item) => item.id),
      totalRegularPrice,
      totalSalePrice,
      estimatedSavings,
      createdAt: Date.now(),
    };
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

  async getOrGenerateCurrentWeekPlan(): Promise<MealPlan> {
    const weekStart = currentMonday();
    const existing = this.mealPlanRepository.findByWeek(weekStart);
    if (existing) return existing;

    const items = await this.discountService.getWeeklyItems(weekStart, "none");
    const plan = this.generatePlan(weekStart, items);
    await this.savePlan(plan);
    return plan;
  }
}
