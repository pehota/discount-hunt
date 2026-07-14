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
import type { WeekStart } from "../../shared/types.ts";

export interface MealPlan {
  id: string;
  weekStart: WeekStart;
  itemIds: string[];
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
      totalRegularPrice: plan.totalRegularPrice,
      totalSalePrice: plan.totalSalePrice,
      estimatedSavings: plan.estimatedSavings,
      createdAt: plan.createdAt,
    }).run();
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
      totalRegularPrice: row.totalRegularPrice,
      totalSalePrice: row.totalSalePrice,
      estimatedSavings: row.estimatedSavings,
      createdAt: row.createdAt,
    };
  }
}
