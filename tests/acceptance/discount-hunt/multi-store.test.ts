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
