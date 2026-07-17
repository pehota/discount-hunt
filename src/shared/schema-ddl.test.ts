/**
 * Tests for the runtime DDL generator (schema-ddl.ts).
 *
 * bypass: PBT — the contract is "generated DDL round-trips through SQLite for
 * EVERY declared table". We enumerate every table generically from schema.ts and
 * assert a create + PRAGMA-table_info round-trip. Expectations are DERIVED from
 * getTableConfig (single source of truth per MY_RULES) — no column list or DDL
 * literal is duplicated here.
 */

import { describe, test, expect } from "bun:test";
import { Database } from "bun:sqlite";
import { is } from "drizzle-orm";
import { getTableConfig, SQLiteTable } from "drizzle-orm/sqlite-core";
import * as schema from "./schema.ts";
import { generateCreateTableSql, generateMissingColumnAlters } from "./schema-ddl.ts";

// Every table declared in schema.ts, enumerated generically. stores FIRST so
// FK-bearing tables can reference it in a fresh DB.
const allTables = (Object.values(schema) as unknown[]).filter((t): t is SQLiteTable =>
  is(t, SQLiteTable)
);
const ordered = [schema.stores as SQLiteTable, ...allTables.filter((t) => t !== schema.stores)];

describe("generateCreateTableSql", () => {
  test("emits CREATE TABLE IF NOT EXISTS for every declared table", () => {
    for (const table of ordered) {
      const sql = generateCreateTableSql(table);
      const name = getTableConfig(table).name;
      expect(sql.startsWith(`CREATE TABLE IF NOT EXISTS ${name}`)).toBe(true);
    }
  });

  test("round-trips: each table creates in a fresh :memory: DB with exactly its declared columns in order", () => {
    const sqlite = new Database(":memory:");
    // Disable FK enforcement so FK-bearing tables create regardless of insert order.
    sqlite.exec("PRAGMA foreign_keys=OFF");

    for (const table of ordered) {
      const cfg = getTableConfig(table);

      // Creates successfully (throws on invalid DDL).
      expect(() => sqlite.exec(generateCreateTableSql(table))).not.toThrow();

      // PRAGMA table_info column names must exactly equal the declared column
      // names, in order — derived from getTableConfig, never hardcoded.
      const actualColumns = (
        sqlite.query(`PRAGMA table_info(${cfg.name})`).all() as { name: string }[]
      ).map((c) => c.name);
      const declaredColumns = cfg.columns.map((c) => c.name);
      expect(actualColumns).toEqual(declaredColumns);
    }
  });
});

describe("generateMissingColumnAlters", () => {
  test("returns [] when every declared column is already present", () => {
    for (const table of ordered) {
      const declared = new Set(getTableConfig(table).columns.map((c) => c.name));
      expect(generateMissingColumnAlters(table, declared)).toEqual([]);
    }
  });

  test("emits an ALTER for a missing healable column, and exec adds it to the table", () => {
    const table = schema.discountItems;
    const cfg = getTableConfig(table);

    // Pick a healable column to omit — derived from getTableConfig, never a
    // hardcoded literal (MY_RULES single-source). Must be reliably ADD-able on a
    // freshly-created (empty here, populated in production) table: exclude PK,
    // UNIQUE, and NOT NULL-without-default (SQLite rejects those on ALTER ADD),
    // so exec succeeds deterministically on any SQLite build (target-machine
    // independence) — matching the real heal loop's addable-column path.
    const healable = cfg.columns.find(
      (c) =>
        !c.primary &&
        !(c as { isUnique?: boolean }).isUnique &&
        !(c.notNull && !c.hasDefault)
    );
    expect(healable).toBeDefined();
    const missingName = healable!.name;

    // Build the reduced legacy table by removing the omitted column's line from
    // the generated CREATE — the "existing" shape lacks exactly that column.
    const reducedCreate = generateCreateTableSql(table)
      .split("\n")
      .filter((line) => !new RegExp(`^\\s*${missingName}\\b`).test(line))
      .join("\n")
      // the removed line may have left a trailing comma on the previous line
      .replace(/,(\s*\n\))/, "$1");

    const sqlite = new Database(":memory:");
    sqlite.exec("PRAGMA foreign_keys=OFF");
    sqlite.exec(reducedCreate);

    const existing = new Set(
      (sqlite.query(`PRAGMA table_info(${cfg.name})`).all() as { name: string }[]).map((r) => r.name)
    );
    expect(existing.has(missingName)).toBe(false);

    const alters = generateMissingColumnAlters(table, existing);
    expect(
      alters.some((s) => s.startsWith(`ALTER TABLE ${cfg.name} ADD COLUMN ${missingName} `))
    ).toBe(true);

    for (const stmt of alters) sqlite.exec(stmt);

    const healed = (
      sqlite.query(`PRAGMA table_info(${cfg.name})`).all() as { name: string }[]
    ).map((r) => r.name);
    expect(healed).toContain(missingName);
  });

  test("never emits an ALTER for PK/unique columns even when absent from existingColumns", () => {
    for (const table of ordered) {
      const cfg = getTableConfig(table);
      const protectedCols = cfg.columns.filter(
        (c) => c.primary || (c as { isUnique?: boolean }).isUnique
      );
      if (protectedCols.length === 0) continue;

      // existingColumns deliberately omits the protected columns — they must
      // still never be emitted (SQLite cannot ADD PK/UNIQUE).
      const withoutProtected = new Set(
        cfg.columns.filter((c) => !protectedCols.includes(c)).map((c) => c.name)
      );
      const alters = generateMissingColumnAlters(table, withoutProtected);
      for (const c of protectedCols) {
        expect(
          alters.some((s) => s.includes(`ADD COLUMN ${c.name} `))
        ).toBe(false);
      }
    }
  });
});
