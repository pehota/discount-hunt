/**
 * test-db — helpers for creating and tearing down ephemeral SQLite test databases.
 *
 * Each test suite calls createTestDb() in beforeAll to get a fresh DB file path.
 * The path is passed as TEST_DB_PATH env var to both the in-process server and
 * any scraper subprocesses so they share the same SQLite file.
 */

import { sql } from "drizzle-orm";
import { getOrCreateStoreId } from "../../../src/shared/store-registry.ts";

export const __SCAFFOLD__ = true as const;

export interface TestDb {
  dbPath: string;
  tmpDir: string;
  cleanup(): void;
}

/**
 * Creates a fresh SQLite DB in a tmp directory.
 * Returns the path and a cleanup function.
 * Caller is responsible for calling cleanup() in afterAll.
 */
export function createTestDb(): TestDb {
  throw new Error("Not yet implemented — RED scaffold");
}

/**
 * Resolve a store NAME to its stores.id for tests that seed scrape_jobs /
 * discount_items directly via Drizzle (name-at-boundary: the schema now uses a
 * store_id FK). Auto-registers unknown names (INSERT OR IGNORE) so non-canonical
 * fixtures keep working. Mirrors the repositories' get-or-create.
 *
 * `db` is a drizzle bun-sqlite client (typed loosely to avoid importing DbClient
 * into every acceptance suite).
 */
export function storeIdFor(
  db: { run: (q: ReturnType<typeof sql>) => unknown; get: (q: ReturnType<typeof sql>) => unknown },
  name: string,
): number {
  return getOrCreateStoreId(db, name);
}
