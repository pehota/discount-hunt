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
import type { CookingTime, DietaryRestriction, MealSlot } from "../../shared/types.ts";

const restrictionArb: fc.Arbitrary<DietaryRestriction> = fc.constantFrom(
  "none", "vegetarian", "vegan",
);

const cookingTimeArb: fc.Arbitrary<CookingTime> = fc.constantFrom("any", "quick");

// Non-empty subset of the two valid meal slots (order-insensitive round-trip).
const mealTypesArb: fc.Arbitrary<MealSlot[]> = fc
  .subarray<MealSlot>(["lunch", "dinner"], { minLength: 1 });

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
  test("get() returns the honest defaults when no row exists", () => {
    withDb((db) => {
      const repo = new SQLiteUserPreferencesRepository(db);
      expect(repo.get()).toEqual({
        dietaryRestriction: "none",
        budgetCapCents: null,
        kidFriendly: false,
        householdSize: 2,
        cookingTime: "any",
        mealTypes: ["lunch", "dinner"],
      });
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
            kidFriendly: false,
            householdSize: 2,
            cookingTime: "any",
            mealTypes: ["lunch", "dinner"],
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
            // Singleton still holds; both fields round-trip. Recipe params fall back to defaults.
            expect(rowCount(db)).toBe(1);
            expect(repo.get()).toEqual({
              dietaryRestriction: restriction,
              budgetCapCents,
              kidFriendly: false,
              householdSize: 2,
              cookingTime: "any",
              mealTypes: ["lunch", "dinner"],
            });
          });
        },
      ),
      { numRuns: 40 },
    );
  });

  // ─── Step 12-01: recipe-search params round-trip (kidFriendly, householdSize,
  //     cookingTime, mealTypes) ────────────────────────────────────────────────
  test("get() returns the documented recipe-param defaults when no row exists", () => {
    withDb((db) => {
      const repo = new SQLiteUserPreferencesRepository(db);
      const prefs = repo.get();
      expect(prefs.kidFriendly).toBe(false);
      expect(prefs.householdSize).toBe(2);
      expect(prefs.cookingTime).toBe("any");
      expect(prefs.mealTypes).toEqual(["lunch", "dinner"]);
    });
  });

  test("for any recipe params, upsert→get round-trips them faithfully (singleton preserved)", () => {
    fc.assert(
      fc.property(
        restrictionArb,
        fc.boolean(),
        fc.integer({ min: 1, max: 12 }),
        cookingTimeArb,
        mealTypesArb,
        (dietaryRestriction, kidFriendly, householdSize, cookingTime, mealTypes) => {
          withDb((db) => {
            const repo = new SQLiteUserPreferencesRepository(db);
            repo.upsert({
              dietaryRestriction,
              budgetCapCents: null,
              kidFriendly,
              householdSize,
              cookingTime,
              mealTypes,
            });
            expect(rowCount(db)).toBe(1);
            // Per-field assertions so household_size (1–12) and kid_friendly (0/1)
            // cannot silently alias across a misaligned positional SELECT tuple.
            const got = repo.get();
            expect(got.dietaryRestriction).toBe(dietaryRestriction);
            expect(got.kidFriendly).toBe(kidFriendly);
            expect(got.householdSize).toBe(householdSize);
            expect(got.cookingTime).toBe(cookingTime);
            expect([...got.mealTypes!].sort()).toEqual([...mealTypes].sort());
          });
        },
      ),
      { numRuns: 40 },
    );
  });

  test("upsert() coalesces omitted recipe params to defaults (undefined → default columns)", () => {
    withDb((db) => {
      const repo = new SQLiteUserPreferencesRepository(db);
      // Only dietary provided — recipe params omitted entirely.
      repo.upsert({ dietaryRestriction: "vegan" });
      const got = repo.get();
      expect(got.kidFriendly).toBe(false);
      expect(got.householdSize).toBe(2);
      expect(got.cookingTime).toBe("any");
      expect(got.mealTypes).toEqual(["lunch", "dinner"]);
    });
  });
});
