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
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDb } from "./db.ts";

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
