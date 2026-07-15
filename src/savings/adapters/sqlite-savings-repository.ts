/**
 * SQLiteSavingsRepository — secondary adapter implementing SavingsRepository port.
 *
 * Table: savings_log (see src/shared/schema.ts)
 * Commands: record, getAll
 *
 * Invariants:
 *   - record: insert-only; no update permitted after creation
 *   - record is called inside the same SQLite transaction as meal_plans write (D23)
 */

import { desc, eq } from "drizzle-orm";
import type { DbClient } from "../../shared/db.ts";
import { savingsLog } from "../../shared/schema.ts";

export interface SavingsRecord {
  id: string;
  planId: string;
  weekStart: string;
  savedAmount: number;      // cents — D23: must equal estimated_savings
  totalSalePrice: number;
  totalRegularPrice: number;
  itemCount: number;
  recordedAt: number;
}

export class SQLiteSavingsRepository {
  constructor(private readonly db: DbClient) {}

  record(savingsRecord: SavingsRecord): void {
    this.db.insert(savingsLog).values({
      id: savingsRecord.id,
      planId: savingsRecord.planId,
      weekStart: savingsRecord.weekStart,
      savedAmount: savingsRecord.savedAmount,
      totalSalePrice: savingsRecord.totalSalePrice,
      totalRegularPrice: savingsRecord.totalRegularPrice,
      itemCount: savingsRecord.itemCount,
      recordedAt: savingsRecord.recordedAt,
    }).run();
  }

  /**
   * Delete this week's savings row (if any). Called inside PlanService.savePlan's
   * transaction so regenerating a week REPLACES rather than double-counts the
   * saved amount. Absent week is a harmless no-op.
   */
  deleteByWeek(weekStart: string): void {
    this.db.delete(savingsLog).where(eq(savingsLog.weekStart, weekStart)).run();
  }

  getAll(): SavingsRecord[] {
    const rows = this.db
      .select()
      .from(savingsLog)
      .orderBy(desc(savingsLog.weekStart))
      .all();

    return rows.map((row) => ({
      id: row.id,
      planId: row.planId,
      weekStart: row.weekStart,
      savedAmount: row.savedAmount,
      totalSalePrice: row.totalSalePrice,
      totalRegularPrice: row.totalRegularPrice,
      itemCount: row.itemCount,
      recordedAt: row.recordedAt,
    }));
  }
}
