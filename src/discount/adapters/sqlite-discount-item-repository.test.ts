/**
 * Unit tests for SQLiteDiscountItemRepository — integration test at adapter boundary.
 *
 * Real in-memory SQLite (via createDb(':memory:')) — per nw-tdd-methodology:
 * "Infrastructure Layer: Integration tests ONLY — use real DB (SQLite in-memory)."
 *
 * Tests the getByWeek() week filter invariant:
 *   - items with validUntil < weekStart MUST be excluded
 *   - items with validUntil >= weekStart MUST be included
 */

import { describe, test, expect } from "bun:test";
import fc from "fast-check";
import { createDb } from "../../shared/db.ts";
import { SQLiteDiscountItemRepository } from "./sqlite-discount-item-repository.ts";
import type { NormalizedItem } from "../../shared/types.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeItem(externalId: string, validUntil: string) {
  return {
    externalId,
    store: "test-store",
    name: `Item ${externalId}`,
    category: "test",
    regularPrice: 200,
    salePrice: 150,
    validUntil,
    dietaryTags: [] as [],
  };
}

// ---------------------------------------------------------------------------
// Single-example integration test: RED before fix (returns both rows)
// ---------------------------------------------------------------------------

describe("SQLiteDiscountItemRepository.getByWeek", () => {
  test("excludes items from prior week and includes items valid during current week", async () => {
    const db = createDb(":memory:");
    const repo = new SQLiteDiscountItemRepository(db);

    const weekStart = "2026-07-14";

    // last-week item (validUntil BEFORE weekStart)
    await repo.register(makeItem("last-week", "2026-07-05"), "job-1");
    // this-week item (validUntil ON weekStart — boundary case)
    await repo.register(makeItem("this-week", "2026-07-15"), "job-2");

    const results = await repo.getByWeek(weekStart, "none");

    expect(results.length).toBe(1);
    expect(results[0]!.validUntil).toBe("2026-07-15");
  });

  // -------------------------------------------------------------------------
  // Property-based test: for any d1 < weekStart <= d2, item(d1) absent, item(d2) present
  // -------------------------------------------------------------------------

  test("property: item with validUntil < weekStart absent; item with validUntil >= weekStart present", async () => {
    // Generate ISO date strings (YYYY-MM-DD) via fast-check
    const isoDateArb = fc
      .date({
        min: new Date("2020-01-01"),
        max: new Date("2030-12-31"),
      })
      .map((d) => d.toISOString().slice(0, 10));

    await fc.assert(
      fc.asyncProperty(
        // weekStart: arbitrary date in [2020-01-02, 2030-12-31] (needs d1 < weekStart)
        fc
          .date({
            min: new Date("2020-01-02"),
            max: new Date("2030-12-30"),
          })
          .map((d) => d.toISOString().slice(0, 10)),
        isoDateArb,
        isoDateArb,
        async (weekStart, rawD1, rawD2) => {
          // Guarantee d1 < weekStart <= d2
          // Sort all three; assign d1 = min, weekStart = mid, d2 = max
          const sorted = [rawD1, weekStart, rawD2].sort();
          const d1 = sorted[0]!;
          const ws = sorted[1]!;
          const d2 = sorted[2]!;

          // If d1 == ws, d1 is NOT before weekStart, skip
          if (d1 >= ws) return;

          const db = createDb(":memory:");
          const repo = new SQLiteDiscountItemRepository(db);

          await repo.register(makeItem("before", d1), "job-1");
          await repo.register(makeItem("onOrAfter", d2), "job-2");

          const results = await repo.getByWeek(ws, "none");
          const ids = results.map((r) => r.id);

          // d1 < weekStart — must be absent
          expect(ids).not.toContain("test-store:before");

          // d2 >= weekStart — must be present (only when d2 != d1 to avoid id conflict)
          // When d1 == d2 both items have same validUntil, both should be present
          expect(ids).toContain("test-store:onOrAfter");
        }
      ),
      { numRuns: 50 }
    );
  });
});

// ---------------------------------------------------------------------------
// register() — persistence + loud guard (11-02)
// ---------------------------------------------------------------------------

describe("SQLiteDiscountItemRepository.register", () => {
  test("persists a complete NormalizedItem as a row", async () => {
    const db = createDb(":memory:");
    const repo = new SQLiteDiscountItemRepository(db);

    await repo.register(makeItem("complete", "2026-07-20"), "job-1");

    const results = await repo.getByWeek("2026-07-14", "none");
    expect(results.map((r) => r.id)).toContain("test-store:complete");
  });

  test("rejects an item with an undefined required field with a named error", async () => {
    // Root cause of the live crash: an undefined interpolation makes Drizzle's
    // `sql` template silently drop the binding, emitting malformed SQL. The
    // guard must fail LOUDLY naming the offending field instead.
    const db = createDb(":memory:");
    const repo = new SQLiteDiscountItemRepository(db);

    const badItem = { ...makeItem("bad", "2026-07-20"), category: undefined } as unknown as NormalizedItem;

    await expect(repo.register(badItem, "job-1")).rejects.toThrow(
      "register: field 'category' is undefined"
    );
  });
});

// ---------------------------------------------------------------------------
// DiscountCategoryStore port — taxonomy_category read/write (categorisation)
// ---------------------------------------------------------------------------

describe("SQLiteDiscountItemRepository — DiscountCategoryStore port", () => {
  test("fresh item is uncategorised (null via getByWeek); findUncategorised surfaces it with the raw category as productType; setTaxonomyCategory persists and removes it from the uncategorised set", async () => {
    const db = createDb(":memory:");
    const repo = new SQLiteDiscountItemRepository(db);

    // makeItem sets category: "test" — that raw German-source category becomes productType.
    await repo.register(makeItem("prod", "2026-07-20"), "job-1");

    // 1. Fresh item: taxonomyCategory null via getByWeek.
    const before = await repo.getByWeek("2026-07-14", "none");
    const storedBefore = before.find((r) => r.id === "test-store:prod");
    expect(storedBefore?.taxonomyCategory).toBeNull();

    // 2. findUncategorised returns it; DB `category` is remapped to port `productType`.
    const uncategorised = repo.findUncategorised();
    const target = uncategorised.find((r) => r.id === "test-store:prod");
    expect(target).toBeDefined();
    expect(target?.productType).toBe("test"); // raw category, NOT taxonomy_category

    // 3. After setTaxonomyCategory: no longer uncategorised; getByWeek shows the new value.
    repo.setTaxonomyCategory("test-store:prod", "Produce");
    expect(repo.findUncategorised().map((r) => r.id)).not.toContain("test-store:prod");

    const after = await repo.getByWeek("2026-07-14", "none");
    const storedAfter = after.find((r) => r.id === "test-store:prod");
    expect(storedAfter?.taxonomyCategory).toBe("Produce");
  });
});
