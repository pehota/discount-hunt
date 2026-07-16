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
import { sql } from "drizzle-orm";
import { createDb } from "../../shared/db.ts";
import { offerHistory } from "../../shared/schema.ts";
import { SQLiteDiscountItemRepository } from "./sqlite-discount-item-repository.ts";
import { currentWeekMonday } from "../../shared/week.ts";
import type { NormalizedItem } from "../../shared/types.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeItem(
  externalId: string,
  validUntil: string,
  sourceUrl: string | null = null,
  details: { imageUrl?: string | null; brand?: string | null; description?: string | null } = {},
) {
  return {
    externalId,
    store: "test-store",
    name: `Item ${externalId}`,
    category: "test",
    regularPrice: 200,
    salePrice: 150,
    validUntil,
    dietaryTags: [] as [],
    sourceUrl,
    imageUrl: details.imageUrl ?? null,
    brand: details.brand ?? null,
    description: details.description ?? null,
  };
}

/**
 * Fresh in-memory db + repo, with parent scrape_jobs rows seeded for the jobId
 * literals the tests use. (scrape_job_id is a soft ref, not an enforced FK, so
 * this seed is for realism rather than a constraint.) createDb seeds the canonical
 * stores; store_id references one of them. NB: drizzle raw `db.get` returns a
 * positional array, so the id is at index [0].
 */
function newRepo(): { db: ReturnType<typeof createDb>; repo: SQLiteDiscountItemRepository } {
  const db = createDb(":memory:");
  const repo = new SQLiteDiscountItemRepository(db);
  const store = db.get(sql`SELECT id FROM stores LIMIT 1`) as [number];
  for (const jobId of ["job-1", "job-2", "job-legacy"]) {
    db.run(sql`
      INSERT OR IGNORE INTO scrape_jobs (id, store_id, status, started_at, item_count)
      VALUES (${jobId}, ${store[0]}, ${"completed"}, ${Date.now()}, ${0})
    `);
  }
  return { db, repo };
}

// ---------------------------------------------------------------------------
// Single-example integration test: RED before fix (returns both rows)
// ---------------------------------------------------------------------------

describe("SQLiteDiscountItemRepository.getByWeek", () => {
  test("excludes items from prior week and includes items valid during current week", async () => {
    const { db, repo } = newRepo();

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
    const { db, repo } = newRepo();

    await repo.register(makeItem("complete", "2026-07-20"), "job-1");

    const results = await repo.getByWeek("2026-07-14", "none");
    expect(results.map((r) => r.id)).toContain("test-store:complete");
  });

  test("source_url round-trips: a URL registered is returned by getByWeek", async () => {
    const { db, repo } = newRepo();

    const url = "https://prospekt.aldi-sued.de/kw27-26-op-mp/";
    await repo.register(makeItem("with-url", "2026-07-20", url), "job-1");

    const results = await repo.getByWeek("2026-07-14", "none");
    const stored = results.find((r) => r.id === "test-store:with-url");
    expect(stored?.sourceUrl).toBe(url);
  });

  test("source_url null round-trips: a null sourceUrl is returned as null (covers legacy rows)", async () => {
    const { db, repo } = newRepo();

    await repo.register(makeItem("no-url", "2026-07-20", null), "job-1");

    const results = await repo.getByWeek("2026-07-14", "none");
    const stored = results.find((r) => r.id === "test-store:no-url");
    expect(stored?.sourceUrl).toBeNull();
  });

  test("detail fields round-trip: imageUrl/brand/description registered are returned by getByWeek", async () => {
    const { db, repo } = newRepo();

    const imageUrl = "https://prospekt.aldi-sued.de/img/42.jpg";
    const brand = "GutBio";
    const description = "Frische Bio-Zucchini aus der Region";
    await repo.register(
      makeItem("with-details", "2026-07-20", null, { imageUrl, brand, description }),
      "job-1",
    );

    const results = await repo.getByWeek("2026-07-14", "none");
    const stored = results.find((r) => r.id === "test-store:with-details");
    expect(stored?.imageUrl).toBe(imageUrl);
    expect(stored?.brand).toBe(brand);
    expect(stored?.description).toBe(description);
  });

  test("detail fields null round-trip: null imageUrl/brand/description are returned as null", async () => {
    const { db, repo } = newRepo();

    await repo.register(makeItem("no-details", "2026-07-20"), "job-1");

    const results = await repo.getByWeek("2026-07-14", "none");
    const stored = results.find((r) => r.id === "test-store:no-details");
    expect(stored?.imageUrl).toBeNull();
    expect(stored?.brand).toBeNull();
    expect(stored?.description).toBeNull();
  });

  test("legacy rows (inserted without the detail columns) read back imageUrl/brand/description as null", async () => {
    const { db, repo } = newRepo();

    // Simulate a pre-migration row: insert omitting image_url/brand/description entirely
    // (the idempotent ALTERs left them nullable → legacy rows carry SQL NULL there).
    // store_id references a seeded store (name-at-boundary); job-legacy is seeded by newRepo.
    const legacyStore = db.get(sql`SELECT id FROM stores LIMIT 1`) as [number];
    db.run(sql`
      INSERT INTO discount_items
        (id, store_id, name, category, regular_price, sale_price, valid_until, dietary_tags, scrape_job_id, created_at)
      VALUES
        (${"test-store:legacy"}, ${legacyStore[0]}, ${"Legacy Item"}, ${"test"},
         ${200}, ${150}, ${"2026-07-20"}, ${"[]"}, ${"job-legacy"}, ${Date.now()})
    `);

    const results = await repo.getByWeek("2026-07-14", "none");
    const stored = results.find((r) => r.id === "test-store:legacy");
    expect(stored).toBeDefined();
    expect(stored?.imageUrl).toBeNull();
    expect(stored?.brand).toBeNull();
    expect(stored?.description).toBeNull();
  });

  test("rejects an item with an undefined required field with a named error", async () => {
    // Root cause of the live crash: an undefined interpolation makes Drizzle's
    // `sql` template silently drop the binding, emitting malformed SQL. The
    // guard must fail LOUDLY naming the offending field instead.
    const { db, repo } = newRepo();

    const badItem = { ...makeItem("bad", "2026-07-20"), category: undefined } as unknown as NormalizedItem;

    await expect(repo.register(badItem, "job-1")).rejects.toThrow(
      "register: field 'category' is undefined"
    );
  });
});

// ---------------------------------------------------------------------------
// replaceStore() — replace-per-store scrape semantics
// ---------------------------------------------------------------------------

describe("SQLiteDiscountItemRepository.replaceStore", () => {
  test("registers a store batch [a,b]; getByWeek shows exactly a,b", async () => {
    const { db, repo } = newRepo();

    repo.replaceStore(
      "test-store",
      [makeItem("a", "2026-07-20"), makeItem("b", "2026-07-20")],
      "job-1",
    );

    const results = await repo.getByWeek("2026-07-14", "none");
    const ids = results.map((r) => r.id);
    expect(new Set(ids)).toEqual(new Set(["test-store:a", "test-store:b"]));
    expect(ids.length).toBe(2);
  });

  test("replaces the store's rows — after [a,b] then [b',c], store has EXACTLY b,c (a gone, no accumulation)", async () => {
    const { db, repo } = newRepo();

    repo.replaceStore(
      "test-store",
      [makeItem("a", "2026-07-20"), makeItem("b", "2026-07-20")],
      "job-1",
    );

    const bPrime = { ...makeItem("b", "2026-07-20"), name: "Item b renamed" };
    repo.replaceStore("test-store", [bPrime, makeItem("c", "2026-07-20")], "job-2");

    const results = await repo.getByWeek("2026-07-14", "none");
    const ids = results.map((r) => r.id);
    expect(new Set(ids)).toEqual(new Set(["test-store:b", "test-store:c"]));
    expect(ids.length).toBe(2);
    // Replacement (delete-then-fresh-insert) preserves the new value, not write-once IGNORE.
    expect(results.find((r) => r.id === "test-store:b")?.name).toBe("Item b renamed");
  });

  test("replaceStore for store Y does NOT affect store X's rows", async () => {
    const { db, repo } = newRepo();

    await repo.register(makeItem("x1", "2026-07-20"), "job-1");
    await repo.register(makeItem("x2", "2026-07-20"), "job-1");

    const storeYItem: NormalizedItem = {
      externalId: "d",
      store: "store-y",
      name: "Item d",
      category: "test",
      regularPrice: 200,
      salePrice: 150,
      validUntil: "2026-07-20",
      dietaryTags: [],
      sourceUrl: null,
      imageUrl: null,
      brand: null,
      description: null,
    };
    repo.replaceStore("store-y", [storeYItem], "job-2");

    const results = await repo.getByWeek("2026-07-14", "none");
    const ids = results.map((r) => r.id);
    expect(ids).toContain("test-store:x1");
    expect(ids).toContain("test-store:x2");
    expect(ids).toContain("store-y:d");
  });

  test("detail fields round-trip via replaceStore: imageUrl/brand/description persist through a batch insert", async () => {
    const { db, repo } = newRepo();

    const imageUrl = "https://prospekt.aldi-sued.de/img/7.jpg";
    const brand = "Milbona";
    const description = "Cremiger Joghurt";
    repo.replaceStore(
      "test-store",
      [makeItem("batch-details", "2026-07-20", null, { imageUrl, brand, description })],
      "job-1",
    );

    const results = await repo.getByWeek("2026-07-14", "none");
    const stored = results.find((r) => r.id === "test-store:batch-details");
    expect(stored?.imageUrl).toBe(imageUrl);
    expect(stored?.brand).toBe(brand);
    expect(stored?.description).toBe(description);
  });

  test("within-run dedup: a batch with two items sharing the same id yields 1 row (INSERT OR IGNORE)", async () => {
    const { db, repo } = newRepo();

    repo.replaceStore(
      "test-store",
      [makeItem("dup", "2026-07-20"), makeItem("dup", "2026-07-20")],
      "job-1",
    );

    const results = await repo.getByWeek("2026-07-14", "none");
    const ids = results.map((r) => r.id);
    expect(ids).toEqual(["test-store:dup"]);
    expect(ids.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// DiscountCategoryStore port — taxonomy_category read/write (categorisation)
// ---------------------------------------------------------------------------

describe("SQLiteDiscountItemRepository — DiscountCategoryStore port", () => {
  test("fresh item is uncategorised (null via getByWeek); findUncategorised surfaces it with the raw category as productType; setCategorisation persists and removes it from the uncategorised set", async () => {
    const { db, repo } = newRepo();

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

    // 3. After setCategorisation: no longer uncategorised; getByWeek shows the new value.
    repo.setCategorisation("test-store:prod", "Produce", []);
    expect(repo.findUncategorised().map((r) => r.id)).not.toContain("test-store:prod");

    const after = await repo.getByWeek("2026-07-14", "none");
    const storedAfter = after.find((r) => r.id === "test-store:prod");
    expect(storedAfter?.taxonomyCategory).toBe("Produce");
  });

  test("fresh row defaults tags to [] via getByWeek (schema '[]' default)", async () => {
    const { db, repo } = newRepo();

    await repo.register(makeItem("fresh", "2026-07-20"), "job-1");

    const [stored] = await repo.getByWeek("2026-07-14", "none");
    expect(stored?.tags).toEqual([]);
  });

  test("setCategorisation writes BOTH taxonomy_category AND tags; tags round-trip as Tag[]", async () => {
    const { db, repo } = newRepo();

    await repo.register(makeItem("fish", "2026-07-20"), "job-1");
    repo.setCategorisation("test-store:fish", "Meat & Fish", ["Frozen", "Organic"]);

    const after = await repo.getByWeek("2026-07-14", "none");
    const stored = after.find((r) => r.id === "test-store:fish");
    expect(stored?.taxonomyCategory).toBe("Meat & Fish");
    expect(stored?.tags).toEqual(["Frozen", "Organic"]);
  });

  test("garbage / unknown tag values are filtered out on read", async () => {
    const { db, repo } = newRepo();

    await repo.register(makeItem("dirty", "2026-07-20"), "job-1");
    // Inject raw malformed tags JSON via the underlying db handle (register() never touches tags).
    db.run(sql`UPDATE discount_items SET tags = '["Frozen","Bogus",123]' WHERE id = ${"test-store:dirty"}`);

    const after = await repo.getByWeek("2026-07-14", "none");
    const stored = after.find((r) => r.id === "test-store:dirty");
    expect(stored?.tags).toEqual(["Frozen"]);
  });

  test("non-array / unparseable tags JSON defaults to []", async () => {
    const { db, repo } = newRepo();

    await repo.register(makeItem("broken", "2026-07-20"), "job-1");
    db.run(sql`UPDATE discount_items SET tags = 'not-json' WHERE id = ${"test-store:broken"}`);

    const after = await repo.getByWeek("2026-07-14", "none");
    const stored = after.find((r) => r.id === "test-store:broken");
    expect(stored?.tags).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// offer_history — archive-on-replace (IDEA-005 Part A)
// ---------------------------------------------------------------------------

describe("offer_history archive-on-replace", () => {
  test("first replace on an empty table archives nothing", async () => {
    const { db, repo } = newRepo();

    repo.replaceStore(
      "test-store",
      [makeItem("a", "2026-07-20"), makeItem("b", "2026-07-20")],
      "job-1",
    );

    const archived = db.select().from(offerHistory).all();
    expect(archived.length).toBe(0);

    const live = await repo.getByWeek("2026-07-14", "none");
    expect(new Set(live.map((r) => r.id))).toEqual(new Set(["test-store:a", "test-store:b"]));
  });

  test("second replace archives the first batch; live rows are only the second batch", async () => {
    const { db, repo } = newRepo();

    const batchA = [makeItem("a", "2026-07-20"), makeItem("b", "2026-07-20")];
    repo.replaceStore("test-store", batchA, "job-1");

    const batchB = [makeItem("c", "2026-07-20"), makeItem("d", "2026-07-20"), makeItem("e", "2026-07-20")];
    repo.replaceStore("test-store", batchB, "job-2");

    const archived = db.select().from(offerHistory).all();
    // Archive holds EXACTLY batch A's rows.
    expect(archived.length).toBe(batchA.length);
    expect(new Set(archived.map((r) => r.itemId))).toEqual(
      new Set(["test-store:a", "test-store:b"]),
    );

    // A known item from A is present with correct sale_price + archive metadata.
    const archivedA = archived.find((r) => r.itemId === "test-store:a");
    expect(archivedA).toBeDefined();
    expect(archivedA?.salePrice).toBe(150); // makeItem's salePrice
    expect(archivedA?.archivedAt).toBeGreaterThan(0);
    expect(archivedA?.weekStart).toBe(currentWeekMonday());

    // Live discount_items for the store contains only batch B (not A).
    const live = await repo.getByWeek("2026-07-14", "none");
    expect(new Set(live.map((r) => r.id))).toEqual(
      new Set(["test-store:c", "test-store:d", "test-store:e"]),
    );
  });

  test("per-store isolation: replacing store X does not archive store Y's rows", async () => {
    const { db, repo } = newRepo();

    // Seed live rows for store Y (first replace archives nothing).
    repo.replaceStore("store-y", [makeItem("y1", "2026-07-20")], "job-1");
    // Seed live rows for store X, then replace X again — only X's first batch archives.
    repo.replaceStore("test-store", [makeItem("x1", "2026-07-20")], "job-1");
    repo.replaceStore("test-store", [makeItem("x2", "2026-07-20")], "job-2");

    const archived = db.select().from(offerHistory).all();
    // Archive holds ONLY store X's first batch — store Y was never re-replaced.
    expect(archived.length).toBe(1);
    expect(archived[0]!.itemId).toBe("test-store:x1");
    // Every archived row belongs to store X's store_id (not Y's).
    const storeXId = archived[0]!.storeId;
    expect(archived.every((r) => r.storeId === storeXId)).toBe(true);
  });
});
