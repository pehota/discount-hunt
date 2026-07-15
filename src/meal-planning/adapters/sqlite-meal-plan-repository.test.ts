/**
 * SQLiteMealPlanRepository — dietaryFilter snapshot round-trip (step 03-01).
 *
 * PBT over the dietary restriction: for any restriction snapshotted onto a plan,
 * save→findByWeek round-trips it faithfully (state-delta over the observable plan
 * surface, strict). The dietaryFilter is the snapshot the dietary effect relies on.
 */

import { describe, test, expect } from "bun:test";
import fc from "fast-check";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDb } from "../../shared/db.ts";
import { SQLiteMealPlanRepository, type MealPlan } from "./sqlite-meal-plan-repository.ts";
import type { DietaryRestriction } from "../../shared/types.ts";

const restrictionArb: fc.Arbitrary<DietaryRestriction> = fc.constantFrom(
  "none", "vegetarian", "vegan",
);

function planWith(
  dietaryFilter: DietaryRestriction,
  weekStart: string,
  budgetCapCents: number | null = null,
): MealPlan {
  return {
    id: `plan-${weekStart}`,
    weekStart,
    itemIds: [],
    meals: [],
    totalRegularPrice: 0,
    totalSalePrice: 0,
    estimatedSavings: 0,
    dietaryFilter,
    budgetCapCents,
    createdAt: Date.now(),
  };
}

describe("SQLiteMealPlanRepository — dietaryFilter snapshot round-trip", () => {
  test("save→findByWeek preserves the snapshotted dietaryFilter for any restriction", () => {
    fc.assert(
      fc.property(restrictionArb, (restriction) => {
        const dir = mkdtempSync(join(tmpdir(), "dh-mealplan-rt-"));
        try {
          const db = createDb(join(dir, "rt.db"));
          const repo = new SQLiteMealPlanRepository(db);
          const weekStart = "2026-07-13";

          repo.save(planWith(restriction, weekStart));
          const loaded = repo.findByWeek(weekStart);

          // Observable snapshot surface: the frozen restriction round-trips.
          expect(loaded).not.toBeNull();
          expect(loaded!.dietaryFilter).toBe(restriction);
        } finally {
          rmSync(dir, { recursive: true, force: true });
        }
      }),
      { numRuns: 30 },
    );
  });
});

// ─── deleteByWeek (replace-on-regenerate) ────────────────────────────────────
describe("SQLiteMealPlanRepository — deleteByWeek", () => {
  test("deleteByWeek removes the week's row; absent week is a no-op", () => {
    const dir = mkdtempSync(join(tmpdir(), "dh-mealplan-del-"));
    try {
      const db = createDb(join(dir, "del.db"));
      const repo = new SQLiteMealPlanRepository(db);
      const weekStart = "2026-07-13";

      repo.save(planWith("none", weekStart));
      expect(repo.findByWeek(weekStart)).not.toBeNull();

      repo.deleteByWeek(weekStart);
      expect(repo.findByWeek(weekStart)).toBeNull();

      // Absent week: does not throw.
      expect(() => repo.deleteByWeek("2026-01-05")).not.toThrow();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ─── Step 04-01: budgetCapCents snapshot round-trip ─────────────────────────
describe("SQLiteMealPlanRepository — budgetCapCents snapshot round-trip", () => {
  test("save→findByWeek preserves the snapshotted budgetCapCents (cents or null)", () => {
    fc.assert(
      fc.property(
        fc.option(fc.integer({ min: 0, max: 10_000_000 }), { nil: null }),
        (budgetCapCents) => {
          const dir = mkdtempSync(join(tmpdir(), "dh-mealplan-budget-rt-"));
          try {
            const db = createDb(join(dir, "rt.db"));
            const repo = new SQLiteMealPlanRepository(db);
            const weekStart = "2026-07-13";

            repo.save(planWith("none", weekStart, budgetCapCents));
            const loaded = repo.findByWeek(weekStart);

            expect(loaded).not.toBeNull();
            expect(loaded!.budgetCapCents).toBe(budgetCapCents);
          } finally {
            rmSync(dir, { recursive: true, force: true });
          }
        },
      ),
      { numRuns: 30 },
    );
  });
});
