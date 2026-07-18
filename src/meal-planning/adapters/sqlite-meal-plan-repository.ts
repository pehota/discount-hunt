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

import { eq, sql, desc } from "drizzle-orm";
import type { DbClient } from "../../shared/db.ts";
import { mealPlans, mealPlanHistory } from "../../shared/schema.ts";
import type { WeekStart, Meal, DietaryRestriction } from "../../shared/types.ts";
import type { MealPlanRepository, ArchivedMealPlan } from "../ports/meal-plan-repository.ts";

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

export class SQLiteMealPlanRepository implements MealPlanRepository {
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
   * Archive-then-delete this week's plan row (if any). Called as the FIRST statement
   * inside PlanService.savePlan's transaction so regenerating a week REPLACES rather
   * than accumulates — and the replaced plan is ARCHIVED, not lost (TECH-06).
   *
   * The archive INSERT ... SELECT copies the OLD row's week_start + created_at verbatim
   * (preserving first-save provenance) and stamps archived_at = now. It runs BEFORE the
   * DELETE, inside the caller's transaction, so archive+delete is atomic — mirroring the
   * SHIPPED SQLiteDiscountItemRepository.replaceStore / offer_history idiom. Absent week
   * is a harmless no-op (the SELECT matches nothing, the DELETE affects 0 rows).
   */
  deleteByWeek(weekStart: WeekStart): void {
    const archivedAt = Date.now();
    this.db.run(sql`
      INSERT INTO meal_plan_history
        (id, week_start, item_ids, meals, dietary_filter, budget_cap_cents,
         total_regular_price, total_sale_price, estimated_savings, created_at, archived_at)
      SELECT id, week_start, item_ids, meals, dietary_filter, budget_cap_cents,
         total_regular_price, total_sale_price, estimated_savings, created_at, ${archivedAt}
      FROM meal_plans WHERE week_start = ${weekStart}
    `);
    this.db.delete(mealPlans).where(eq(mealPlans.weekStart, weekStart)).run();
  }

  /**
   * All archived (previously-saved, then replaced) plans, most-recently-archived first.
   * Read surface behind GET /plan/archive. Each row retains its ORIGINAL week_start +
   * created_at — the archive preserves provenance; only archived_at is new.
   */
  listArchivedPlans(): ArchivedMealPlan[] {
    const rows = this.db
      .select()
      .from(mealPlanHistory)
      .orderBy(desc(mealPlanHistory.archivedAt))
      .all();

    return rows.map((row) => ({
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
      archivedAt: row.archivedAt,
    }));
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
