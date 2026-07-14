/**
 * SavingsService — domain service for the Savings Tracking bounded context.
 *
 * Use cases:
 *   getHistory(): returns SavingsRecord[] ordered by week_start DESC
 *   recordSavings(planId, ...): called by PlanService in same transaction (not via HTTP)
 *
 * Invariants:
 *   - saved_amount = total_regular_price - total_sale_price (verified at creation)
 *   - recordSavings is called inside PlanService.savePlan transaction (D23)
 */

import { randomUUID } from "node:crypto";
import type { SQLiteSavingsRepository, SavingsRecord } from "./adapters/sqlite-savings-repository.ts";

export class SavingsService {
  constructor(private readonly savingsRepository: SQLiteSavingsRepository) {}

  async getHistory(): Promise<SavingsRecord[]> {
    return this.savingsRepository.getAll();
  }

  recordSavings(
    planId: string,
    savedAmount: number,
    totalSalePrice: number,
    totalRegularPrice: number,
    itemCount: number,
    weekStart: string,
  ): void {
    const record: SavingsRecord = {
      id: randomUUID(),
      planId,
      weekStart,
      savedAmount,
      totalSalePrice,
      totalRegularPrice,
      itemCount,
      recordedAt: Date.now(),
    };
    this.savingsRepository.record(record);
  }
}
