/**
 * SQLiteSavingsRepository — deleteByWeek (replace-on-regenerate).
 *
 * Folding delete-by-week into the savePlan transaction is what makes double-counting
 * impossible by construction: regenerating a week wipes its prior savings_log row
 * before the new one is written. Here we verify the adapter primitive in isolation.
 */

import { describe, test, expect } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDb } from "../../shared/db.ts";
import { SQLiteSavingsRepository, type SavingsRecord } from "./sqlite-savings-repository.ts";

function recordFor(weekStart: string): SavingsRecord {
  return {
    id: `rec-${weekStart}`,
    planId: `plan-${weekStart}`,
    weekStart,
    savedAmount: 290,
    totalSalePrice: 337,
    totalRegularPrice: 627,
    itemCount: 3,
    recordedAt: Date.now(),
  };
}

describe("SQLiteSavingsRepository — deleteByWeek", () => {
  test("deleteByWeek removes the week's row; absent week is a no-op", () => {
    const dir = mkdtempSync(join(tmpdir(), "dh-savings-del-"));
    try {
      const db = createDb(join(dir, "del.db"));
      const repo = new SQLiteSavingsRepository(db);
      const weekStart = "2026-07-13";

      repo.record(recordFor(weekStart));
      expect(repo.getAll().filter((r) => r.weekStart === weekStart)).toHaveLength(1);

      repo.deleteByWeek(weekStart);
      expect(repo.getAll().filter((r) => r.weekStart === weekStart)).toHaveLength(0);

      // Absent week: does not throw.
      expect(() => repo.deleteByWeek("2026-01-05")).not.toThrow();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
