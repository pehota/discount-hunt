/**
 * SQLiteMealPlanRepository — secondary adapter implementing MealPlanRepository port.
 *
 * Table: meal_plans (see src/shared/schema.ts)
 * Commands: save, findByWeek
 *
 * Invariants:
 *   - save is called inside the same SQLite transaction as savings_log write (D23)
 *   - findByWeek queries by week_start for idempotency check in PlanService
 */

import { eq } from "drizzle-orm";
import type { DbClient } from "../../shared/db.ts";
import { mealPlans } from "../../shared/schema.ts";
import type { WeekStart, Meal, DietaryRestriction } from "../../shared/types.ts";

export interface MealPlan {
  id: string;
  weekStart: WeekStart;
  itemIds: string[];
  meals: Meal[];
  dietaryFilter: DietaryRestriction; // snapshotted restriction at generation (D25)
  budgetCapCents: number | null; // snapshotted weekly cap at generation; null = no cap
  totalRegularPrice: number; // cents
  totalSalePrice: number;    // cents
  estimatedSavings: number;  // cents — D23 atomic
  createdAt: number;
}

export class SQLiteMealPlanRepository {
  constructor(private readonly db: DbClient) {}

  save(plan: MealPlan): void {
    this.db.insert(mealPlans).values({
      id: plan.id,
      weekStart: plan.weekStart,
      itemIds: JSON.stringify(plan.itemIds),
      meals: JSON.stringify(plan.meals),
      dietaryFilter: plan.dietaryFilter ?? "none",
      budgetCapCents: plan.budgetCapCents ?? null,
      totalRegularPrice: plan.totalRegularPrice,
      totalSalePrice: plan.totalSalePrice,
      estimatedSavings: plan.estimatedSavings,
      createdAt: plan.createdAt,
    }).run();
  }

  /**
   * Delete this week's plan row (if any). Called inside PlanService.savePlan's
   * transaction so regenerating a week REPLACES rather than accumulates. Absent
   * week is a harmless no-op (0 rows affected).
   */
  deleteByWeek(weekStart: WeekStart): void {
    this.db.delete(mealPlans).where(eq(mealPlans.weekStart, weekStart)).run();
  }

  findByWeek(weekStart: WeekStart): MealPlan | null {
    const row = this.db
      .select()
      .from(mealPlans)
      .where(eq(mealPlans.weekStart, weekStart))
      .get();

    if (!row) return null;

    return {
      id: row.id,
      weekStart: row.weekStart,
      itemIds: JSON.parse(row.itemIds) as string[],
      meals: JSON.parse(row.meals) as Meal[],
      dietaryFilter: row.dietaryFilter as DietaryRestriction,
      budgetCapCents: row.budgetCapCents ?? null,
      totalRegularPrice: row.totalRegularPrice,
      totalSalePrice: row.totalSalePrice,
      estimatedSavings: row.estimatedSavings,
      createdAt: row.createdAt,
    };
  }
}
