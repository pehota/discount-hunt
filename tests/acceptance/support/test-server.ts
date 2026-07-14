/**
 * test-server — helpers for starting and stopping the real production HTTP server
 * in acceptance tests.
 *
 * Wraps the createServer() export from src/server.ts (production composition root).
 * The server is started with an ephemeral port and a test-specific SQLite DB path.
 */

export const __SCAFFOLD__ = true as const;

export interface TestServer {
  port: number;
  baseUrl: string;
  stop(): void;
}

/**
 * Starts the real Bun.serve server (production composition root) on a random port.
 * The server reads all state from the SQLite file at dbPath.
 */
export async function startTestServer(dbPath: string): Promise<TestServer> {
  throw new Error("Not yet implemented — RED scaffold");
}
