/**
 * @driving_port — Shared UI shell present on every page; feed uses cards (phase 06).
 *
 * Proves the presentation upgrade wired in step 06-02:
 *   - GET /, /plan, /savings, /settings each return HTML containing the shared
 *     top nav (class="site-nav"), links to the four routes, and an inline <style>.
 *   - GET / renders each discount item inside a card element (data-item-card).
 *
 * This is a wiring/rendering AT (single-example): it verifies that the four
 * handlers route their body through renderPage and that the feed wraps items in
 * cards. The item-name / staleness / empty-state / data-* markers are covered by
 * the existing ATs (walking-skeleton, multi-store, savings-history, budget-cap,
 * dietary-preferences) which must all stay green after the refactor.
 *
 * Infrastructure: real SQLite temp DB + real HTTP server (createServer), no mocks.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { randomUUID } from "node:crypto";
import { createDb } from "../../../src/shared/db.ts";
import { scrapeJobs, discountItems } from "../../../src/shared/schema.ts";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SEEDED_ITEM = "Kürbis";

describe("@driving_port — shared shell on all routes; feed uses cards", () => {
  let tmpDir: string;
  let dbPath: string;
  let serverPort: number;
  let server: { stop(): void } | null = null;

  function daysFromNow(n: number): string {
    return new Date(Date.now() + n * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  }

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "discount-hunt-ui-shell-"));
    dbPath = join(tmpDir, "ui-shell-test.db");

    const db = createDb(dbPath);
    const now = Date.now();
    const jobId = randomUUID();

    // A completed scrape job so the feed renders the per-store path and the item shows.
    db.insert(scrapeJobs).values({
      id: jobId,
      store: "Aldi Süd",
      status: "completed",
      startedAt: now - 3600 * 1000,
      completedAt: now - 1800 * 1000,
      itemCount: 1,
    }).run();

    // One current-week discount item so GET / has an item to render as a card.
    db.insert(discountItems).values({
      id: "ui-shell-item-001",
      store: "Aldi Süd",
      name: SEEDED_ITEM,
      category: "vegetable",
      regularPrice: 199,
      salePrice: 129,
      validUntil: daysFromNow(7),
      dietaryTags: "[]",
      scrapeJobId: jobId,
      createdAt: now,
    }).run();

    const { createServer } = await import("../../../src/server.ts");
    const s = await createServer({ port: 0, dbPath });
    server = s;
    serverPort = s.port;
  });

  afterAll(() => {
    server?.stop();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  const ROUTES = ["/", "/plan", "/savings", "/settings"];

  for (const route of ROUTES) {
    test(`GET ${route} renders the shared nav shell and inline <style>`, async () => {
      const response = await fetch(`http://localhost:${serverPort}${route}`);
      expect(response.ok).toBe(true);
      const html = await response.text();

      expect(html).toContain(`class="site-nav"`);
      expect(html).toContain("<style");
      expect(html).toMatch(/href="\/"/);
      expect(html).toMatch(/href="\/plan"/);
      expect(html).toMatch(/href="\/savings"/);
      expect(html).toMatch(/href="\/settings"/);
    });
  }

  test("GET / renders each discount item inside a card (data-item-card)", async () => {
    const response = await fetch(`http://localhost:${serverPort}/`);
    expect(response.ok).toBe(true);
    const html = await response.text();

    expect(html).toContain("data-item-card");
    expect(html).toContain(SEEDED_ITEM);
    // The seeded item name lives inside a card element.
    expect(html).toMatch(/data-item-card[\s\S]*?Kürbis/);
  });
});
