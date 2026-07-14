/**
 * Integration tests for createDb.
 *
 * bypass: PBT — db creation is a side-effect (I/O), not an invariant.
 * A single-example integration test verifying wiring is correct per
 * nw-tdd-methodology: "Integration: single-example test verifies WIRING."
 *
 * WAL NOTE: SQLite in-memory databases permanently use 'memory' journal mode.
 * PRAGMA journal_mode=WAL on :memory: returns 'memory', never 'wal'.
 * WAL assertion therefore uses a file-backed temp DB.
 */

import { describe, test, expect, afterAll } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDb } from "./db.ts";
import { userSettings, mealPlans } from "./schema.ts";

let tempDir: string;

describe("createDb", () => {
  afterAll(() => {
    // Clean up temp WAL files (journal sidecar files)
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("returns a drizzle client for :memory: and probe passes", () => {
    const db = createDb(":memory:");
    // The client must be a live drizzle instance (not null/undefined)
    expect(db).toBeDefined();
    expect(typeof db).toBe("object");
  });

  test("WAL mode is enabled on a file-backed database", () => {
    tempDir = mkdtempSync(join(tmpdir(), "discount-hunt-test-"));
    const dbPath = join(tempDir, "test.db");
    const db = createDb(dbPath);

    // Access the underlying bun:sqlite Database via $client to query pragmas
    const rawDb = (db as unknown as { $client: { query(sql: string): { get(): unknown } } }).$client;
    const result = rawDb.query("PRAGMA journal_mode").get() as { journal_mode: string };
    expect(result.journal_mode).toBe("wal");
  });

});

// ─── Step 03-01: user_settings + meal_plans.dietary_filter foundation ─────────
// bypass: schema-migration boot is single-example integration (verifies WIRING /
// the guarded ALTER), not an invariant. Mirrors multi-store Block 2 (meals column).

describe("createDb — user_settings + meal_plans.dietary_filter foundation", () => {
  test("a fresh DB exposes user_settings with the dietary defaults", () => {
    const dir = mkdtempSync(join(tmpdir(), "dh-db-usersettings-"));
    try {
      const db = createDb(join(dir, "fresh.db"));
      db.insert(userSettings).values({ updatedAt: Date.now() }).run();
      const row = db.select().from(userSettings).get();
      expect(row).not.toBeNull();
      expect(row!.userId).toBe("dimitar");
      expect(row!.dietaryRestriction).toBe("none");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a fresh DB exposes meal_plans.dietary_filter defaulting to 'none'", () => {
    const dir = mkdtempSync(join(tmpdir(), "dh-db-dietfilter-"));
    try {
      const db = createDb(join(dir, "fresh.db"));
      db.insert(mealPlans).values({
        id: "plan-1",
        weekStart: "2026-07-13",
        itemIds: "[]",
        meals: "[]",
        totalRegularPrice: 0,
        totalSalePrice: 0,
        estimatedSavings: 0,
        createdAt: Date.now(),
      }).run();
      const row = db.select().from(mealPlans).get();
      expect(row!.dietaryFilter).toBe("none");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a pre-existing meal_plans without dietary_filter is migrated by a guarded ALTER", () => {
    const dir = mkdtempSync(join(tmpdir(), "dh-db-migrate-"));
    const dbPath = join(dir, "legacy.db");
    try {
      const legacy = new Database(dbPath);
      legacy.exec(`
        CREATE TABLE meal_plans (
          id TEXT PRIMARY KEY,
          week_start TEXT NOT NULL,
          item_ids TEXT NOT NULL,
          meals TEXT NOT NULL DEFAULT '[]',
          total_regular_price INTEGER NOT NULL,
          total_sale_price INTEGER NOT NULL,
          estimated_savings INTEGER NOT NULL,
          created_at INTEGER NOT NULL
        )
      `);
      legacy.close();

      expect(() => createDb(dbPath)).not.toThrow();

      const db = createDb(dbPath);
      db.insert(mealPlans).values({
        id: "legacy-plan-1",
        weekStart: "2026-07-13",
        itemIds: "[]",
        meals: "[]",
        totalRegularPrice: 0,
        totalSalePrice: 0,
        estimatedSavings: 0,
        createdAt: Date.now(),
      }).run();
      const row = db.select().from(mealPlans).get();
      expect(row!.dietaryFilter).toBe("none");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
