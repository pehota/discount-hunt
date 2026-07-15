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
import { currentWeekMonday } from "../shared/week.ts";
import type { SQLiteSavingsRepository, SavingsRecord } from "./adapters/sqlite-savings-repository.ts";

/**
 * View model powering the SLICE-04 savings UI. Aggregates the full history into
 * the three UI surfaces: the current-week breakdown, the month-to-date total,
 * and the set of weeks with no captured regular price ("savings unavailable").
 */
export interface SavingsSummary {
  history: SavingsRecord[]; // all records, DESC by weekStart (unchanged getHistory contract)
  thisWeek: SavingsRecord | null; // record whose weekStart === current week Monday
  monthToDateCents: number; // sum of savedAmount over current-month weeks with a captured regular price
  unavailableWeekStarts: string[]; // weekStarts where totalRegularPrice === 0 (savings not computable)
}

/** A savings record has no computable savings when its regular price was never captured. */
export function isSavingsUnavailable(record: SavingsRecord): boolean {
  return record.totalRegularPrice === 0;
}

/**
 * Pure month-to-date summation over an EXPLICIT reference month ("YYYY-MM").
 *
 * Sums savedAmount for records whose weekStart falls in referenceMonth AND whose
 * regular price was actually captured (uncaptured-regular rows are excluded — their
 * savedAmount is meaningless). Taking referenceMonth as an argument (rather than
 * deriving it internally) lets the semantics be unit-tested independently of
 * currentWeekMonday(): "current month" = calendar month of the current week's Monday.
 */
export function sumMonthToDateCents(records: SavingsRecord[], referenceMonth: string): number {
  return records
    .filter((record) => record.weekStart.slice(0, 7) === referenceMonth)
    .filter((record) => !isSavingsUnavailable(record))
    .reduce((sum, record) => sum + record.savedAmount, 0);
}

export class SavingsService {
  constructor(private readonly savingsRepository: SQLiteSavingsRepository) {}

  async getHistory(): Promise<SavingsRecord[]> {
    return this.savingsRepository.getAll();
  }

  async getSummary(): Promise<SavingsSummary> {
    const history = await this.getHistory();
    const currentWeek = currentWeekMonday();
    const referenceMonth = currentWeek.slice(0, 7);

    const thisWeek = history.find((record) => record.weekStart === currentWeek) ?? null;

    const monthToDateCents = sumMonthToDateCents(history, referenceMonth);

    const unavailableWeekStarts = history
      .filter((record) => isSavingsUnavailable(record))
      .map((record) => record.weekStart);

    return { history, thisWeek, monthToDateCents, unavailableWeekStarts };
  }

  /**
   * Delete this week's savings row. Delegated to the repo so PlanService can wipe
   * the prior savings_log entry inside its savePlan transaction without importing
   * drizzle (D34). Synchronous — it runs inside the sync bun-sqlite transaction.
   */
  deleteByWeek(weekStart: string): void {
    this.savingsRepository.deleteByWeek(weekStart);
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
