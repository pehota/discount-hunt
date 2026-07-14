/**
 * Walking Skeleton — Multi-Store S01-ext
 *
 * Scenario: "Shopper sees discount items from two stores on the dashboard"
 * Tags: @walking_skeleton @driving_port
 *
 * Proves that two scrapers (Aldi Süd + V-Markt) can both populate discount_items
 * and that GET / renders items grouped by store with a heading per store.
 *
 * Infrastructure:
 *   - Real subprocess: bun run src/scraping/scraper-runner.ts with CATALOGUE_SOURCE=fake
 *   - Real SQLite DB (temp file)
 *   - Real HTTP server (createServer)
 *   - No mocking of server internals
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import fc from "fast-check";
import { randomUUID } from "node:crypto";
import { createDb } from "../../../src/shared/db.ts";
import { scrapeJobs } from "../../../src/shared/schema.ts";
import { isStale } from "../../../src/discount/http/discount-handler.ts";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// ─── Fixtures ────────────────────────────────────────────────────────────────

/**
 * Aldi Süd fixture — 2 items with both prices.
 * Shape: prospekt.aldi-sued.de hotspot JSON (SPIKE-01 addendum).
 */
const ALDI_FIXTURE = JSON.stringify([
  {
    id: "aldi-ms-001",
    title: "Brokkoli",
    brand: "Aldi",
    price: "1.49",
    discountedPrice: "0.79",
    customLabel1: "2026-07-14",
    productType: "vegetable",
    photoUrls: [],
  },
  {
    id: "aldi-ms-002",
    title: "Kichererbsen",
    brand: "Aldi",
    price: "1.99",
    discountedPrice: "1.29",
    customLabel1: "2026-07-14",
    productType: "legume",
    photoUrls: [],
  },
]);

/**
 * V-Markt fixture — 2 items with both prices.
 * Same CatalogueItem shape at skeleton stage (LLM extraction is Slice-02 DELIVER).
 * SPIKE-03 sample items: cheese + yogurt from pageflip.v-markt.de/muenchen.
 */
const VMARKT_FIXTURE = JSON.stringify([
  {
    id: "vmarkt-ms-001",
    title: "Gouda Scheiben",
    brand: "V-Markt",
    price: "2.99",
    discountedPrice: "1.99",
    customLabel1: "2026-07-14",
    productType: "dairy",
    photoUrls: [],
  },
  {
    id: "vmarkt-ms-002",
    title: "Naturjoghurt",
    brand: "V-Markt",
    price: "1.29",
    discountedPrice: "0.89",
    customLabel1: "2026-07-14",
    productType: "dairy",
    photoUrls: [],
  },
]);

// ─── Scenario: Shopper sees discount items from two stores on the dashboard ───

describe(
  "@walking_skeleton @driving_port — Shopper sees discount items from two stores on the dashboard",
  () => {
    let tmpDir: string;
    let dbPath: string;
    let aldiFixturePath: string;
    let vMarktFixturePath: string;
    let serverPort: number;
    let server: { stop(): void } | null = null;

    beforeAll(async () => {
      // Given: the application starts fresh with a temp DB
      tmpDir = mkdtempSync(join(tmpdir(), "discount-hunt-multi-store-"));
      dbPath = join(tmpDir, "test.db");

      // Given: Aldi Süd catalogue fake is configured
      aldiFixturePath = join(tmpDir, "aldi-fixture.json");
      writeFileSync(aldiFixturePath, ALDI_FIXTURE, "utf8");

      // Given: V-Markt catalogue fake is configured
      vMarktFixturePath = join(tmpDir, "vmarkt-fixture.json");
      writeFileSync(vMarktFixturePath, VMARKT_FIXTURE, "utf8");

      // When: the scraper runs for both stores
      const scraperResult = Bun.spawnSync(
        ["bun", "run", "src/scraping/scraper-runner.ts"],
        {
          env: {
            ...process.env,
            CATALOGUE_SOURCE: "fake",
            FAKE_CATALOGUE_FIXTURE: aldiFixturePath,
            FAKE_VMARKT_FIXTURE: vMarktFixturePath,
            TEST_DB_PATH: dbPath,
          },
          cwd: join(import.meta.dir, "../../.."), // project root
        }
      );

      // Scraper must exit 0
      expect(scraperResult.exitCode).toBe(0);

      // Start real HTTP server against the same DB
      const { createServer } = await import("../../../src/server.ts");
      serverPort = 3200 + Math.floor(Math.random() * 700); // port range 3200–3899
      server = await createServer({ port: serverPort, dbPath });
    });

    afterAll(() => {
      server?.stop();
      rmSync(tmpDir, { recursive: true, force: true });
    });

    test("dashboard shows at least one item from Aldi Süd", async () => {
      const response = await fetch(`http://localhost:${serverPort}/`);
      expect(response.ok).toBe(true);

      const html = await response.text();

      // Store heading must be present
      expect(html).toContain("Aldi Süd");
      // At least one Aldi item name must appear
      expect(html).toContain("Brokkoli");
    });

    test("dashboard shows at least one item from V-Markt", async () => {
      const response = await fetch(`http://localhost:${serverPort}/`);
      expect(response.ok).toBe(true);

      const html = await response.text();

      // Store heading must be present
      expect(html).toContain("V-Markt");
      // At least one V-Markt item name must appear
      expect(html).toContain("Gouda Scheiben");
    });

    test("each store section is labelled with its store name as a heading", async () => {
      const response = await fetch(`http://localhost:${serverPort}/`);
      expect(response.ok).toBe(true);

      const html = await response.text();

      // Both store headings must appear as h2 elements
      expect(html).toMatch(/<h2[^>]*>Aldi Süd<\/h2>/);
      expect(html).toMatch(/<h2[^>]*>V-Markt<\/h2>/);
    });

    test("items from both stores are all present", async () => {
      const response = await fetch(`http://localhost:${serverPort}/`);
      expect(response.ok).toBe(true);

      const html = await response.text();

      // All Aldi items
      expect(html).toContain("Brokkoli");
      expect(html).toContain("Kichererbsen");
      // All V-Markt items
      expect(html).toContain("Gouda Scheiben");
      expect(html).toContain("Naturjoghurt");
    });
  }
);

// ─── PBT unit test: isStale predicate ────────────────────────────────────────
// Mandate 1 budget: 1 behavior × 2 = 2 max unit tests. We use 1 PBT.

describe("isStale predicate — fast-check", () => {
  const FORTY_EIGHT_HOURS_MS = 48 * 3600 * 1000;

  test("completedAt older than 48h is always stale", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 10 * 24 * 3600 * 1000 }), // 1ms–10 days past threshold
        (delta) => {
          const now = Date.now();
          const completedAt = now - FORTY_EIGHT_HOURS_MS - delta;
          return isStale(completedAt, now) === true;
        }
      )
    );
  });

  test("completedAt within 48h is never stale", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: FORTY_EIGHT_HOURS_MS - 1 }), // 0ms–47h59m59s999ms
        (delta) => {
          const now = Date.now();
          const completedAt = now - delta;
          return isStale(completedAt, now) === false;
        }
      )
    );
  });
});

// ─── AT extension: staleness warning ─────────────────────────────────────────

describe("staleness warning", () => {
  let tmpDir: string;
  let dbPath: string;
  let serverPort: number;
  let server: { stop(): void } | null = null;
  const STALE_STORE = "Aldi Süd";
  const FRESH_STORE = "V-Markt";

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "discount-hunt-staleness-"));
    dbPath = join(tmpDir, "staleness-test.db");

    // Seed scrape_jobs directly — need aged timestamps that cannot come from completeJob
    const db = createDb(dbPath);
    const now = Date.now();

    // Stale row: 72h ago (beyond 48h threshold)
    db.insert(scrapeJobs).values({
      id: randomUUID(),
      store: STALE_STORE,
      status: "completed",
      startedAt: now - 72 * 3600 * 1000 - 5000,
      completedAt: now - 72 * 3600 * 1000,
      itemCount: 0,
    }).run();

    // Fresh row: 24h ago (within 48h threshold)
    db.insert(scrapeJobs).values({
      id: randomUUID(),
      store: FRESH_STORE,
      status: "completed",
      startedAt: now - 24 * 3600 * 1000 - 5000,
      completedAt: now - 24 * 3600 * 1000,
      itemCount: 0,
    }).run();

    const { createServer } = await import("../../../src/server.ts");
    serverPort = 3900 + Math.floor(Math.random() * 99); // port range 3900–3999
    server = await createServer({ port: serverPort, dbPath });
  });

  afterAll(() => {
    server?.stop();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("Criterion 1: stale store (72h) shows staleness-warning element referencing the store name", async () => {
    const response = await fetch(`http://localhost:${serverPort}/`);
    expect(response.ok).toBe(true);
    const html = await response.text();

    expect(html).toContain(`class="staleness-warning"`);
    expect(html).toContain(STALE_STORE);
  });

  test("Criterion 2: fresh store (24h, within 48h threshold) shows no staleness warning", async () => {
    const response = await fetch(`http://localhost:${serverPort}/`);
    expect(response.ok).toBe(true);
    const html = await response.text();

    // No warning referencing V-Markt specifically
    expect(html).not.toMatch(new RegExp(`class="staleness-warning"[^<]*${FRESH_STORE}`));
    // More precisely: no staleness-warning div should mention V-Markt
    const warningMatches = html.match(/<div class="staleness-warning">[^<]*<\/div>/g) ?? [];
    expect(warningMatches.every((w) => !w.includes(FRESH_STORE))).toBe(true);
  });

  test("Criterion 3: store with 0 items this week shows per-store empty-state message", async () => {
    const response = await fetch(`http://localhost:${serverPort}/`);
    expect(response.ok).toBe(true);
    const html = await response.text();

    expect(html).toContain(`No discounts this week at ${STALE_STORE}`);
  });

  test("Criterion 6: staleness banner appears only for the stale store", async () => {
    const response = await fetch(`http://localhost:${serverPort}/`);
    expect(response.ok).toBe(true);
    const html = await response.text();

    // Warning appears for stale store
    expect(html).toContain(STALE_STORE);
    // Only one staleness-warning div total (not one for each store)
    const warningCount = (html.match(/class="staleness-warning"/g) ?? []).length;
    expect(warningCount).toBe(1);
  });
});
