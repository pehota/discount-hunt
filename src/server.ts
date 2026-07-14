/**
 * Composition root — src/server.ts (D35: wire → probe → register routes)
 *
 * Production entry point:
 *   bun run src/server.ts
 *
 * Accepts optional config for test seam:
 *   createServer({ port, dbPath }) — used in acceptance tests to start on a random port
 *   with a test-specific SQLite file.
 *
 * When run directly (not imported), reads TEST_DB_PATH env var (if set) or defaults
 * to ./discount-hunt.db.
 *
 * Wire order (D35):
 *   1. createDb(dbPath) — opens SQLite, enables WAL, runs startup probe
 *   2. Instantiate all adapters (SQLite repos, fake adapters if CATALOGUE_SOURCE=fake)
 *   3. Instantiate all domain services
 *   4. Register HTTP routes with Bun.serve
 *   5. Adapters that fail their probe: log health.startup.refused, exit code 1
 */

export const __SCAFFOLD__ = true as const;

export interface ServerConfig {
  port: number;
  dbPath: string;
}

export interface ServerHandle {
  stop(): void;
}

/**
 * Creates and starts the HTTP server with the production composition root.
 * Returns a handle with stop() for graceful shutdown (used in tests).
 */
export async function createServer(config: ServerConfig): Promise<ServerHandle> {
  throw new Error("Not yet implemented — RED scaffold");
}

// Direct invocation (cron / systemd)
if (import.meta.main) {
  const port = Number(process.env["PORT"] ?? 3000);
  const dbPath = process.env["TEST_DB_PATH"] ?? "./discount-hunt.db";
  createServer({ port, dbPath }).catch((err) => {
    console.error("health.startup.refused", err);
    process.exit(1);
  });
}
