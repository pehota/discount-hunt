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
  test("get() returns the honest defaults { dietaryRestriction: 'none', budgetCapCents: null } when no row exists", () => {
    withDb((db) => {
      const repo = new SQLiteUserPreferencesRepository(db);
      expect(repo.get()).toEqual({ dietaryRestriction: "none", budgetCapCents: null });
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
          // Last-write-wins (seq has minLength 1, so the last element is defined).
          expect(repo.get()).toEqual({
            dietaryRestriction: seq[seq.length - 1]!,
            budgetCapCents: null,
          });
        });
      }),
      { numRuns: 40 },
    );
  });

  // ─── Step 04-01: budget_cap_cents round-trip ────────────────────────────────
  test("get() returns budgetCapCents: null when no row exists", () => {
    withDb((db) => {
      const repo = new SQLiteUserPreferencesRepository(db);
      expect(repo.get().budgetCapCents).toBeNull();
    });
  });

  test("for any budget cap (cents or null), upsert→get round-trips it faithfully", () => {
    fc.assert(
      fc.property(
        restrictionArb,
        fc.option(fc.integer({ min: 0, max: 10_000_000 }), { nil: null }),
        (restriction, budgetCapCents) => {
          withDb((db) => {
            const repo = new SQLiteUserPreferencesRepository(db);
            repo.upsert({ dietaryRestriction: restriction, budgetCapCents });
            // Singleton still holds; both fields round-trip.
            expect(rowCount(db)).toBe(1);
            expect(repo.get()).toEqual({
              dietaryRestriction: restriction,
              budgetCapCents,
            });
          });
        },
      ),
      { numRuns: 40 },
    );
  });
});
