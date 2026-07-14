/**
 * test-db — helpers for creating and tearing down ephemeral SQLite test databases.
 *
 * Each test suite calls createTestDb() in beforeAll to get a fresh DB file path.
 * The path is passed as TEST_DB_PATH env var to both the in-process server and
 * any scraper subprocesses so they share the same SQLite file.
 */

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
