/**
 * SavingsService — domain service for the Savings Tracking bounded context.
 *
 * Use cases:
 *   GetHistory(): returns SavingsRecord[] ordered by week_start DESC
 *   RecordSavings(planId, ...): called by PlanService in same transaction (not via HTTP)
 *   ReplaceSavings(weekStart, planId, ...): replaces current week's record only (D24)
 *
 * Invariants:
 *   - Prior weeks (week_start < current Monday) are immutable — reject ReplaceSavings for them
 *   - saved_amount = total_regular_price - total_sale_price (verified at creation)
 *   - ReplaceSavings enforces week_start >= currentMonday() guard
 */

export const __SCAFFOLD__ = true as const;

export class SavingsService {
  constructor(private readonly savingsRepository: unknown) {}

  async getHistory(): Promise<unknown[]> {
    throw new Error("Not yet implemented — RED scaffold");
  }

  async recordSavings(planId: string, savedAmount: number, totalSalePrice: number, totalRegularPrice: number, itemCount: number): Promise<void> {
    throw new Error("Not yet implemented — RED scaffold");
  }

  async replaceSavings(weekStart: string, planId: string, savedAmount: number, totalSalePrice: number, totalRegularPrice: number, itemCount: number): Promise<void> {
    throw new Error("Not yet implemented — RED scaffold");
  }
}
