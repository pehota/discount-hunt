/**
 * Integration test for SQLiteShoppingListRepository (classical TDD at the hexagonal
 * boundary). Real bun:sqlite in-memory DB — no mocks; the adapter IS the code under test.
 *
 * # bypass: adapter integration tests verify the port↔SQLite bridge with concrete rows
 * (dedup, week-scoping, delete). These are wiring contracts, not equivalence-class
 * invariants — property-framing adds no coverage over the representative cases below.
 *
 * Behaviors:
 *   B1: addItems then listByWeek round-trips the row (all columns, nulls preserved)
 *   B2: listByWeek is week-scoped (another week's rows excluded)
 *   B3: discount rows dedup by discount_item_id — against existing rows AND within a batch
 *   B4: manual rows always insert (no dedup, even if repeated)
 *   B5: removeById deletes only the matching row for the week
 */

import { describe, test, expect, beforeEach } from "bun:test";
import { createDb } from "../../shared/db.ts";
import { SQLiteShoppingListRepository } from "./sqlite-shopping-list-repository.ts";
import type { ShoppingListItem } from "../ports/shopping-list-repository.ts";

const WEEK = "2026-07-13";
const OTHER_WEEK = "2026-07-06";

function discountRow(overrides: Partial<ShoppingListItem> = {}): ShoppingListItem {
  return {
    id: crypto.randomUUID(),
    weekStart: WEEK,
    source: "discount",
    name: "Zucchini",
    store: "aldi",
    salePriceCents: 99,
    regularPriceCents: 199,
    discountItemId: "aldi:item-001",
    taxonomyCategory: "Produce",
    addedAt: Date.now(),
    ...overrides,
  };
}

function manualRow(overrides: Partial<ShoppingListItem> = {}): ShoppingListItem {
  return {
    id: crypto.randomUUID(),
    weekStart: WEEK,
    source: "manual",
    name: "Milk",
    store: null,
    salePriceCents: 129,
    regularPriceCents: null,
    discountItemId: null,
    taxonomyCategory: "Other",
    addedAt: Date.now(),
    ...overrides,
  };
}

describe("SQLiteShoppingListRepository", () => {
  let repo: SQLiteShoppingListRepository;

  beforeEach(() => {
    repo = new SQLiteShoppingListRepository(createDb(":memory:"));
  });

  test("B1: round-trips a discount row incl. null-free columns", () => {
    const row = discountRow();
    repo.addItems([row]);

    const listed = repo.listByWeek(WEEK);
    expect(listed).toHaveLength(1);
    expect(listed[0]).toEqual(row);
  });

  test("B1b: round-trips a manual row preserving null store/regularPrice/discountItemId", () => {
    const row = manualRow();
    repo.addItems([row]);

    const listed = repo.listByWeek(WEEK);
    expect(listed).toHaveLength(1);
    expect(listed[0]!.store).toBeNull();
    expect(listed[0]!.regularPriceCents).toBeNull();
    expect(listed[0]!.discountItemId).toBeNull();
    expect(listed[0]).toEqual(row);
  });

  test("B2: listByWeek excludes another week's rows", () => {
    repo.addItems([discountRow({ discountItemId: "aldi:a" })]);
    repo.addItems([discountRow({ weekStart: OTHER_WEEK, discountItemId: "aldi:b" })]);

    const listed = repo.listByWeek(WEEK);
    expect(listed).toHaveLength(1);
    expect(listed[0]!.weekStart).toBe(WEEK);
  });

  test("B3a: discount row is skipped when discountItemId already exists for the week", () => {
    repo.addItems([discountRow({ discountItemId: "aldi:dup" })]);
    repo.addItems([discountRow({ discountItemId: "aldi:dup" })]);

    expect(repo.listByWeek(WEEK)).toHaveLength(1);
  });

  test("B3b: duplicate discount rows within the same batch collapse to one", () => {
    repo.addItems([
      discountRow({ discountItemId: "aldi:dup" }),
      discountRow({ discountItemId: "aldi:dup" }),
    ]);

    expect(repo.listByWeek(WEEK)).toHaveLength(1);
  });

  test("B3c: same discountItemId in a DIFFERENT week is NOT deduped", () => {
    repo.addItems([discountRow({ discountItemId: "aldi:x" })]);
    repo.addItems([discountRow({ weekStart: OTHER_WEEK, discountItemId: "aldi:x" })]);

    expect(repo.listByWeek(WEEK)).toHaveLength(1);
    expect(repo.listByWeek(OTHER_WEEK)).toHaveLength(1);
  });

  test("B4: manual rows always insert, even when repeated", () => {
    repo.addItems([manualRow({ name: "Milk" })]);
    repo.addItems([manualRow({ name: "Milk" })]);

    expect(repo.listByWeek(WEEK)).toHaveLength(2);
  });

  test("B5: removeById deletes only the matching row for the week", () => {
    const keep = discountRow({ discountItemId: "aldi:keep" });
    const drop = discountRow({ discountItemId: "aldi:drop" });
    repo.addItems([keep, drop]);

    repo.removeById(drop.id, WEEK);

    const listed = repo.listByWeek(WEEK);
    expect(listed).toHaveLength(1);
    expect(listed[0]!.id).toBe(keep.id);
  });

  test("B5b: removeById with a non-existent id is a no-op", () => {
    repo.addItems([discountRow()]);
    repo.removeById("nope", WEEK);
    expect(repo.listByWeek(WEEK)).toHaveLength(1);
  });

  test("B6: taxonomy_category round-trips through addItems/listByWeek", () => {
    repo.addItems([discountRow({ taxonomyCategory: "Bakery" })]);
    expect(repo.listByWeek(WEEK)[0]!.taxonomyCategory).toBe("Bakery");
  });

  test("B6b: a legacy row with NULL taxonomy_category reads back as 'Other'", () => {
    // Simulate a row written before the column existed: insert directly with a NULL
    // taxonomy_category, bypassing the type-required field on addItems.
    const db = createDb(":memory:");
    const legacyRepo = new SQLiteShoppingListRepository(db);
    (db as unknown as { $client: { exec(sql: string): void } }).$client.exec(
      `INSERT INTO shopping_list_items (id, week_start, source, name, added_at, taxonomy_category)
       VALUES ('legacy-1', '${WEEK}', 'manual', 'Old Item', ${Date.now()}, NULL)`,
    );
    expect(legacyRepo.listByWeek(WEEK)[0]!.taxonomyCategory).toBe("Other");
  });
});
