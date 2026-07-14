/**
 * SQLiteMealPlanRepository — secondary adapter implementing MealPlanRepository port.
 *
 * Table: meal_plans (see src/shared/schema.ts)
 * Commands: save, getByWeek, replaceCurrentWeek, getRecentRecipeIds
 *
 * Invariants:
 *   - replaceCurrentWeek deletes + reinserts current week's row only (D24)
 *   - savePlan is called inside the same SQLite transaction as savings_log write (D23)
 *   - getRecentRecipeIds(since) used by PlanService for 4-week rotation exclusion (D36)
 */

export const __SCAFFOLD__ = true as const;

export class SQLiteMealPlanRepository {
  constructor(private readonly db: unknown) {}

  async save(plan: unknown): Promise<void> {
    throw new Error("Not yet implemented — RED scaffold");
  }

  async getByWeek(weekStart: string): Promise<unknown | null> {
    throw new Error("Not yet implemented — RED scaffold");
  }

  async replaceCurrentWeek(plan: unknown): Promise<void> {
    throw new Error("Not yet implemented — RED scaffold");
  }

  async getRecentRecipeIds(since: Date): Promise<string[]> {
    throw new Error("Not yet implemented — RED scaffold");
  }
}
