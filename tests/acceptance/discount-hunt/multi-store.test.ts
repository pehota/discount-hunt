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
import { scrapeJobs, discountItems } from "../../../src/shared/schema.ts";
import { storeIdFor } from "../support/test-db.ts";
import { isStale } from "../../../src/discount/http/discount-handler.ts";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";

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
      const s = await createServer({ port: 0, dbPath });
      server = s;
      serverPort = s.port;
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
      storeId: storeIdFor(db, STALE_STORE),
      status: "completed",
      startedAt: now - 72 * 3600 * 1000 - 5000,
      completedAt: now - 72 * 3600 * 1000,
      itemCount: 0,
    }).run();

    // Fresh row: 24h ago (within 48h threshold)
    db.insert(scrapeJobs).values({
      id: randomUUID(),
      storeId: storeIdFor(db, FRESH_STORE),
      status: "completed",
      startedAt: now - 24 * 3600 * 1000 - 5000,
      completedAt: now - 24 * 3600 * 1000,
      itemCount: 0,
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

// ─── Regression AT: prior-week filter ────────────────────────────────────────
// Regression AT: was RED before fix in step 02-06
// Bug: getByWeek() returned items from all historical weeks (missing WHERE valid_until >= weekStart)
// Fix: added .where(gte(discountItems.validUntil, weekStart)) in sqlite-discount-item-repository.ts

describe("prior-week filter — past items must not appear in GET /", () => {
  let tmpDir: string;
  let dbPath: string;
  let serverPort: number;
  let server: { stop(): void } | null = null;

  function daysFromNow(n: number): string {
    return new Date(Date.now() + n * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  }

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "discount-hunt-filter-"));
    dbPath = join(tmpDir, "filter-test.db");

    const db = createDb(dbPath);
    const now = Date.now();
    const jobId = randomUUID();

    // Insert a scrape_jobs row so knownStores is non-empty → per-store rendering path
    db.insert(scrapeJobs).values({
      id: jobId,
      storeId: storeIdFor(db, "Aldi Süd"),
      status: "completed",
      startedAt: now - 3600 * 1000,
      completedAt: now - 1800 * 1000,
      itemCount: 2,
    }).run();

    const pastDate = daysFromNow(-14); // safely before any current week Monday
    const futureDate = daysFromNow(7);  // safely after current week Monday

    // Past item (must NOT appear in GET /)
    db.insert(discountItems).values({
      id: "test-past-001",
      storeId: storeIdFor(db, "Aldi Süd"),
      name: "StaleItem",
      category: "vegetable",
      regularPrice: 199,
      salePrice: 99,
      validUntil: pastDate,
      dietaryTags: "[]",
      scrapeJobId: jobId,
      createdAt: now - 14 * 24 * 3600 * 1000,
    }).run();

    // Current item (must appear in GET /)
    db.insert(discountItems).values({
      id: "test-current-001",
      storeId: storeIdFor(db, "Aldi Süd"),
      name: "FreshItem",
      category: "vegetable",
      regularPrice: 299,
      salePrice: 149,
      validUntil: futureDate,
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

  test("past item (validUntil 14 days ago) is absent from GET /", async () => {
    const response = await fetch(`http://localhost:${serverPort}/`);
    expect(response.ok).toBe(true);
    const html = await response.text();
    expect(html).not.toContain("StaleItem");
  });

  test("current item (validUntil 7 days from now) is present in GET /", async () => {
    const response = await fetch(`http://localhost:${serverPort}/`);
    expect(response.ok).toBe(true);
    const html = await response.text();
    expect(html).toContain("FreshItem");
  });
});

// ─── Regression AT: schema migration boot ────────────────────────────────────
// Regression AT: was RED before fix in step 02-06
// Bug: createDb() threw when re-opening an existing DB that already has the meals column
//      (ALTER TABLE fails with "duplicate column name: meals" without the try/catch guard)
// Fix: added try/catch ALTER TABLE around meals column addition in db.ts
//
// The guard is needed for the case where the DB was already created with the current
// schema (meals column present), and createDb is called again — e.g. server restart.

describe("schema migration boot — re-opening an existing DB with meals column starts without error", () => {
  let tmpDir: string;
  let dbPath: string;
  let serverPort: number;
  let server: { stop(): void } | null = null;

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "discount-hunt-migration-"));
    dbPath = join(tmpDir, "existing-schema.db");

    // Step 1: Bootstrap the DB with the CURRENT schema (meals column already present).
    // This simulates a DB that was previously created by createDb (e.g. from a prior server run).
    const bootstrapDb = new Database(dbPath);
    bootstrapDb.exec(`
      CREATE TABLE scrape_jobs (
        id TEXT PRIMARY KEY, store TEXT NOT NULL, status TEXT NOT NULL,
        started_at INTEGER NOT NULL, completed_at INTEGER, item_count INTEGER NOT NULL DEFAULT 0, error_message TEXT
      );
      CREATE TABLE discount_items (
        id TEXT PRIMARY KEY, store TEXT NOT NULL, name TEXT NOT NULL, category TEXT NOT NULL,
        regular_price INTEGER NOT NULL, sale_price INTEGER NOT NULL, valid_until TEXT NOT NULL,
        dietary_tags TEXT NOT NULL DEFAULT '[]', scrape_job_id TEXT NOT NULL, created_at INTEGER NOT NULL
      );
      CREATE TABLE meal_plans (
        id TEXT PRIMARY KEY, week_start TEXT NOT NULL, item_ids TEXT NOT NULL,
        meals TEXT NOT NULL DEFAULT '[]',
        total_regular_price INTEGER NOT NULL, total_sale_price INTEGER NOT NULL,
        estimated_savings INTEGER NOT NULL, created_at INTEGER NOT NULL
      );
      CREATE TABLE savings_log (
        id TEXT PRIMARY KEY, plan_id TEXT NOT NULL, week_start TEXT NOT NULL,
        saved_amount INTEGER NOT NULL, total_sale_price INTEGER NOT NULL,
        total_regular_price INTEGER NOT NULL, item_count INTEGER NOT NULL, recorded_at INTEGER NOT NULL
      );
    `);
    bootstrapDb.close();

    // Step 2: Call createServer on the same DB path.
    // createDb internally runs ALTER TABLE meal_plans ADD COLUMN meals — which would throw
    // "duplicate column name: meals" without the try/catch guard.
    const { createServer } = await import("../../../src/server.ts");
    const s = await createServer({ port: 0, dbPath });
    server = s;
    serverPort = s.port;
  });

  afterAll(() => {
    server?.stop();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("server starts without error when DB already has the meals column", () => {
    // If createServer threw in beforeAll, server would be null and this test verifies that
    expect(server).not.toBeNull();
  });

  test("POST /plan/generate returns a non-500 response on the re-opened DB", async () => {
    const response = await fetch(`http://localhost:${serverPort}/plan/generate`, {
      method: "POST",
      redirect: "manual", // capture the 303, not the redirect target
    });
    // 303 redirect is the correct response; 500 means the migration failed
    expect(response.status).not.toBe(500);
  });
});

// ─── AT: schema migration boot — forward path ────────────────────────────────
// Forward-migration path: DB created WITHOUT meals column (pre-02-04 schema)
// → createDb() runs ALTER TABLE meal_plans ADD COLUMN meals TEXT NOT NULL DEFAULT '[]'
// → meals column is present → server starts.

describe("schema migration boot — opening a pre-meals DB adds the meals column without error", () => {
  let tmpDir: string;
  let dbPath: string;
  let serverPort: number;
  let server: { stop(): void } | null = null;

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "discount-hunt-forward-migration-"));
    dbPath = join(tmpDir, "pre-meals-schema.db");

    // Bootstrap a DB with the PRE-meals schema (meals column intentionally absent).
    // This simulates a DB created before the 02-04 migration was introduced.
    const bootstrapDb = new Database(dbPath);
    bootstrapDb.exec(`
      CREATE TABLE scrape_jobs (
        id TEXT PRIMARY KEY, store TEXT NOT NULL, status TEXT NOT NULL,
        started_at INTEGER NOT NULL, completed_at INTEGER, item_count INTEGER NOT NULL DEFAULT 0, error_message TEXT
      );
      CREATE TABLE discount_items (
        id TEXT PRIMARY KEY, store TEXT NOT NULL, name TEXT NOT NULL, category TEXT NOT NULL,
        regular_price INTEGER NOT NULL, sale_price INTEGER NOT NULL, valid_until TEXT NOT NULL,
        dietary_tags TEXT NOT NULL DEFAULT '[]', scrape_job_id TEXT NOT NULL, created_at INTEGER NOT NULL
      );
      CREATE TABLE meal_plans (
        id TEXT PRIMARY KEY, week_start TEXT NOT NULL, item_ids TEXT NOT NULL,
        total_regular_price INTEGER NOT NULL, total_sale_price INTEGER NOT NULL,
        estimated_savings INTEGER NOT NULL, created_at INTEGER NOT NULL
      );
      CREATE TABLE savings_log (
        id TEXT PRIMARY KEY, plan_id TEXT NOT NULL, week_start TEXT NOT NULL,
        saved_amount INTEGER NOT NULL, total_sale_price INTEGER NOT NULL,
        total_regular_price INTEGER NOT NULL, item_count INTEGER NOT NULL, recorded_at INTEGER NOT NULL
      );
    `);
    bootstrapDb.close();

    // Call createServer — createDb internally runs ALTER TABLE meal_plans ADD COLUMN meals,
    // which should succeed on a DB that does NOT yet have that column.
    const { createServer } = await import("../../../src/server.ts");
    const s = await createServer({ port: 0, dbPath });
    server = s;
    serverPort = s.port;
  });

  afterAll(() => {
    server?.stop();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("server starts without error on a pre-meals DB", () => {
    expect(server).not.toBeNull();
  });

  test("meals column is present after migration", () => {
    // Open a fresh raw Database to inspect the schema after createServer ran createDb.
    const db = new Database(dbPath);
    const columns = db.query("PRAGMA table_info(meal_plans)").all();
    db.close();
    const hasMeals = columns.some((r: any) => r.name === "meals");
    expect(hasMeals).toBe(true);
  });
});
