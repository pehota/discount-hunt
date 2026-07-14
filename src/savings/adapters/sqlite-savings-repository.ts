/**
 * SQLiteSavingsRepository — secondary adapter implementing SavingsRepository port.
 *
 * Table: savings_log (see src/shared/schema.ts)
 * Commands: record, replace, getHistory
 *
 * Invariants:
 *   - replace: enforces week_start >= currentMonday() guard; rejects prior weeks
 *   - record: insert-only; no update permitted after creation
 */

export const __SCAFFOLD__ = true as const;

export class SQLiteSavingsRepository {
  constructor(private readonly db: unknown) {}

  async record(savingsRecord: unknown): Promise<void> {
    throw new Error("Not yet implemented — RED scaffold");
  }

  async replace(weekStart: string, savingsRecord: unknown): Promise<void> {
    throw new Error("Not yet implemented — RED scaffold");
  }

  async getHistory(): Promise<unknown[]> {
    throw new Error("Not yet implemented — RED scaffold");
  }
}
