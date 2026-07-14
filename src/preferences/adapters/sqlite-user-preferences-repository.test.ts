/**
 * SQLiteUserPreferencesRepository — singleton + default invariants (step 03-02).
 *
 * Real SQLite (never mocked — adapter integration, Mandate 6). PBT over restriction
 * sequences with a state-delta view of the observable surface: the row count and the
 * value get() returns.
 */

import { describe, test, expect } from "bun:test";
import fc from "fast-check";
import { sql } from "drizzle-orm";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDb, type DbClient } from "../../shared/db.ts";
import { userSettings } from "../../shared/schema.ts";
import { SQLiteUserPreferencesRepository } from "./sqlite-user-preferences-repository.ts";
import type { DietaryRestriction } from "../../shared/types.ts";

const restrictionArb: fc.Arbitrary<DietaryRestriction> = fc.constantFrom(
  "none", "vegetarian", "vegan",
);

function rowCount(db: DbClient): number {
  // drizzle-orm/bun-sqlite .get() returns a positional value array.
  const row = db.get<[number]>(sql`SELECT COUNT(*) AS n FROM user_settings`);
  return row ? row[0] : -1;
}

function withDb<T>(run: (db: DbClient) => T): T {
  const dir = mkdtempSync(join(tmpdir(), "dh-prefs-"));
  try {
    return run(createDb(join(dir, "prefs.db")));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("SQLiteUserPreferencesRepository", () => {
  test("get() returns the honest default { dietaryRestriction: 'none' } when no row exists", () => {
    withDb((db) => {
      const repo = new SQLiteUserPreferencesRepository(db);
      expect(repo.get()).toEqual({ dietaryRestriction: "none" });
      // Universe guard: reading must not create a row.
      expect(rowCount(db)).toBe(0);
    });
  });

  test("for any non-empty sequence of upserts, the table holds exactly 1 row and get() returns the last value", () => {
    fc.assert(
      fc.property(fc.array(restrictionArb, { minLength: 1, maxLength: 8 }), (seq) => {
        withDb((db) => {
          const repo = new SQLiteUserPreferencesRepository(db);
          for (const restriction of seq) {
            repo.upsert({ dietaryRestriction: restriction });
          }
          // Singleton invariant: the fixed-PK upsert cannot grow the table.
          expect(rowCount(db)).toBe(1);
          // Last-write-wins.
          expect(repo.get()).toEqual({ dietaryRestriction: seq[seq.length - 1] });
        });
      }),
      { numRuns: 40 },
    );
  });
});
