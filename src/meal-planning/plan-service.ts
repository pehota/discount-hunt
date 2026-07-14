/**
 * PlanService — core domain service for the Meal Planning bounded context.
 *
 * Use cases (D36 plan-value pattern):
 *   generatePlan(weekStart, preferences): MealPlan — pure computation; no DB writes
 *   savePlan(plan): void                          — only impure function; writes meal_plans +
 *                                                   savings_log in ONE SQLite transaction (D23)
 *
 * Invariants:
 *   - isCompatible() pre-filter applied BEFORE meal assignment (D33 / dietary filter brief)
 *   - getRecentRecipeIds(since: 4 weeks ago) excludes recently used recipes (D36 rotation)
 *   - estimated_savings = SUM(regularPrice - salePrice) for all meals with a discount_item_id
 *   - savePlan writes both meal_plans.estimated_savings and savings_log.saved_amount in same transaction (D23)
 *
 * Driven ports: MealPlanRepository, DiscountItemRepository, RecipeRepository, PreferencesRepository
 */

export const __SCAFFOLD__ = true as const;

import type { WeekStart } from "../shared/types.ts";

export class PlanService {
  constructor(
    private readonly mealPlanRepository: unknown,
    private readonly discountService: unknown,
    private readonly recipeService: unknown,
    private readonly preferencesRepository: unknown,
    private readonly savingsRepository: unknown,
  ) {}

  generatePlan(weekStart: WeekStart, preferences: unknown): unknown {
    throw new Error("Not yet implemented — RED scaffold");
  }

  async savePlan(plan: unknown): Promise<void> {
    throw new Error("Not yet implemented — RED scaffold");
  }

  async getOrGenerateCurrentWeekPlan(): Promise<unknown> {
    throw new Error("Not yet implemented — RED scaffold");
  }
}
