/**
 * Walking Skeleton — discount-hunt S01
 *
 * Executable companion to walking-skeleton.feature.
 *
 * D23 structural assertion contract (required of production handlers):
 *   - plan-handler renders estimated_savings as `data-estimated-savings="{cents}"` (integer, no decimals)
 *   - savings-handler renders saved_amount as `data-saved-amount="{cents}"` (integer, no decimals)
 *   These data attributes let the test assert equality at the value level, not the display format level.
 *
 * All scaffolds throw "Not yet implemented — RED scaffold".
 * Fail-for-right-reason classification deferred to DELIVER PREPARE (post bun install).
 *
 * Only Scenario 1 (happy path) is enabled. Scenario 2 is declared but skipped.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// ─── Test fixtures ────────────────────────────────────────────────────────────

/**
 * Aldi catalogue fixture — happy path.
 * Three items with BOTH price (regular_price) and discountedPrice (sale_price).
 * price > discountedPrice invariant enforced per D22 + shared-artifacts-registry.
 * JSON shape matches prospekt.aldi-sued.de (SPIKE-01 addendum).
 */
const HAPPY_PATH_CATALOGUE = JSON.stringify([
  {
    id: "item-001",
    title: "Zucchini",
    brand: "Aldi",
    price: "1.99",
    discountedPrice: "0.99",
    customLabel1: "2026-07-14",
    productType: "vegetable",
    photoUrls: [],
  },
  {
    id: "item-002",
    title: "Rote Linsen",
    brand: "Aldi",
    price: "2.49",
    discountedPrice: "1.49",
    customLabel1: "2026-07-14",
    productType: "legume",
    photoUrls: [],
  },
  {
    id: "item-003",
    title: "Spinat",
    brand: "Aldi",
    price: "1.79",
    discountedPrice: "0.89",
    customLabel1: "2026-07-14",
    productType: "vegetable",
    photoUrls: [],
  },
]);

/**
 * Aldi catalogue fixture — error path (Scenario 2).
 * Items with price only — no discountedPrice.
 * The normalizer's both-price filter must discard all of these (SPIKE-01 / D21).
 * Returns items with PRICE-ONLY to exercise the normalizer's filter path,
 * not an empty array (which would test nothing).
 */
const ERROR_PATH_CATALOGUE = JSON.stringify([
  {
    id: "item-101",
    title: "Kartoffeln",
    brand: "Aldi",
    price: "3.99",
    // no discountedPrice — should be discarded by normalizer
    customLabel1: "2026-07-14",
    productType: "vegetable",
    photoUrls: [],
  },
  {
    id: "item-102",
    title: "Möhren",
    brand: "Aldi",
    price: "1.29",
    // no discountedPrice — should be discarded by normalizer
    customLabel1: "2026-07-14",
    productType: "vegetable",
    photoUrls: [],
  },
]);

// ─── Scenario 1: Happy path ───────────────────────────────────────────────────

describe("Walking Skeleton — Scenario 1: Shopper sees discounted items, generates a meal plan, and confirms savings match the estimate", () => {
  let tmpDir: string;
  let dbPath: string;
  let fixtureJsonPath: string;
  let serverPort: number;
  let server: { stop(): void } | null = null;
  let estimatedSavingRendered: string | null = null; // extracted from plan HTML; compared against savings HTML

  beforeAll(async () => {
    // Step: "the discount-hunt application is running against a fresh database"
    tmpDir = mkdtempSync(join(tmpdir(), "discount-hunt-test-"));
    dbPath = join(tmpDir, "test.db");

    // Step: "the Aldi catalogue fake is configured"
    // Write happy-path fixture to a tmp file so the subprocess can read it
    fixtureJsonPath = join(tmpDir, "catalogue-fixture.json");
    writeFileSync(fixtureJsonPath, HAPPY_PATH_CATALOGUE, "utf8");

    // Step: "the scraper runs and completes successfully"
    // Real subprocess — captures exit code. Fake injected via env vars.
    const scraperResult = Bun.spawnSync(
      ["bun", "run", "src/scraping/scraper-runner.ts"],
      {
        env: {
          ...process.env,
          CATALOGUE_SOURCE: "fake",
          FAKE_CATALOGUE_FIXTURE: fixtureJsonPath,
          TEST_DB_PATH: dbPath,
        },
        cwd: join(import.meta.dir, "../../.."), // project root
      }
    );

    // Scraper must exit 0 for "completes successfully"
    expect(scraperResult.exitCode).toBe(0);

    // Start the real HTTP server (production composition root) pointing at the same DB
    // src/server.ts reads TEST_DB_PATH env var when present (test seam)
    const { createServer } = await import("../../../src/server.ts");
    const s = await createServer({
      port: 0,
      dbPath,
    });
    server = s;
    serverPort = s.port;
  });

  afterAll(() => {
    server?.stop();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("the discount feed shows 3 discount items each with a 'was' price and a sale price", async () => {
    // Step: "the Aldi catalogue has 3 discounted items with both regular price and sale price"
    // (established in beforeAll via fixture)

    const response = await fetch(`http://localhost:${serverPort}/`);
    expect(response.ok).toBe(true);

    const html = await response.text();

    // Pillar 1: assert observable user outcome — items visible with both prices
    expect(html).toContain("Zucchini");
    expect(html).toContain("Rote Linsen");
    expect(html).toContain("Spinat");

    // Every discount item must show both "was" price (regular_price) and sale price
    // The UI renders regular_price as "was €X.XX" (D22: regular_price immutable, captured at scrape)
    expect(html).toContain("1.99"); // Zucchini regular_price
    expect(html).toContain("0.99"); // Zucchini sale_price
    expect(html).toContain("2.49"); // Rote Linsen regular_price
    expect(html).toContain("1.49"); // Rote Linsen sale_price
    expect(html).toContain("1.79"); // Spinat regular_price
    expect(html).toContain("0.89"); // Spinat sale_price

    // No items without both prices should appear (D21 invariant)
    expect(html).not.toContain("No discounts available this week");
  });

  test("the meal plan shows an estimated weekly saving", async () => {
    // Step: "the shopper generates a meal plan"
    const generateResponse = await fetch(
      `http://localhost:${serverPort}/plan/generate`,
      { method: "POST" }
    );

    // Plan generation must succeed
    expect(generateResponse.ok).toBe(true);

    const planResponse = await fetch(`http://localhost:${serverPort}/plan`);
    expect(planResponse.ok).toBe(true);

    const planHtml = await planResponse.text();

    // D23: plan-handler MUST render estimated_savings as a machine-readable data attribute:
    //   <span data-estimated-savings="290">€2.90</span>   (amount in cents, integer)
    // Extracting via data attribute (not display format) makes this locale- and format-stable.
    const attrMatch = planHtml.match(/data-estimated-savings="(\d+)"/);
    expect(attrMatch).not.toBeNull(); // plan must expose estimated_savings as data attribute
    estimatedSavingRendered = attrMatch![1]; // cents string e.g. "290"

    // 14-meal assertion: plan must contain exactly 14 meal slot entries (7 days × 2 slots)
    expect((planHtml.match(/data-meal-slot/g) ?? []).length).toBe(14);
  });

  test("the saved amount in the savings tracker matches the estimated saving from the meal plan", async () => {
    // Step: "the shopper views the savings tracker"
    const savingsResponse = await fetch(`http://localhost:${serverPort}/savings`);
    expect(savingsResponse.ok).toBe(true);

    const savingsHtml = await savingsResponse.text();

    // D23: savings-handler MUST render saved_amount as a machine-readable data attribute:
    //   <span data-saved-amount="290">€2.90</span>   (amount in cents, integer)
    // Assert the cents value from the plan equals the cents value from savings —
    // not a test-authored constant. This makes the D23 same-transaction invariant
    // structurally load-bearing: if the transaction writes different values to
    // meal_plans.estimated_savings and savings_log.saved_amount, this test fails.
    expect(estimatedSavingRendered).not.toBeNull();
    const savingsAttrMatch = savingsHtml.match(/data-saved-amount="(\d+)"/);
    expect(savingsAttrMatch).not.toBeNull();
    expect(savingsAttrMatch![1]).toBe(estimatedSavingRendered!);
  });
});

// ─── Scenario 2: Error path (SKIPPED — enable after Scenario 1 is GREEN) ─────

describe.skip("Walking Skeleton — Scenario 2: Shopper sees empty discount feed when catalogue contains no items with both prices", () => {
  let tmpDir: string;
  let dbPath: string;
  let fixtureJsonPath: string;
  let serverPort: number;
  let server: { stop(): void } | null = null;

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "discount-hunt-test-error-"));
    dbPath = join(tmpDir, "test.db");

    fixtureJsonPath = join(tmpDir, "catalogue-fixture-error.json");
    writeFileSync(fixtureJsonPath, ERROR_PATH_CATALOGUE, "utf8");

    // Step: "the scraper runs and completes successfully"
    // Even when no discount items are found, the scraper exits 0 (partial scrape, no failure)
    const scraperResult = Bun.spawnSync(
      ["bun", "run", "src/scraping/scraper-runner.ts"],
      {
        env: {
          ...process.env,
          CATALOGUE_SOURCE: "fake",
          FAKE_CATALOGUE_FIXTURE: fixtureJsonPath,
          TEST_DB_PATH: dbPath,
        },
        cwd: join(import.meta.dir, "../../.."),
      }
    );

    expect(scraperResult.exitCode).toBe(0);

    const { createServer } = await import("../../../src/server.ts");
    const s = await createServer({
      port: 0,
      dbPath,
    });
    server = s;
    serverPort = s.port;
  });

  afterAll(() => {
    server?.stop();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("the discount feed shows 'No discounts available this week'", async () => {
    // Step: "the Aldi catalogue has items but none have both a regular price and a sale price"
    // (established in beforeAll via error-path fixture — items with price-only)

    const response = await fetch(`http://localhost:${serverPort}/`);
    expect(response.ok).toBe(true);

    const html = await response.text();

    // The normalizer discards items missing discountedPrice (D21 / SPIKE-01)
    // The UI must show the empty-state message, not an empty list
    expect(html).toContain("No discounts available this week");

    // None of the price-only items should appear in the feed
    expect(html).not.toContain("Kartoffeln");
    expect(html).not.toContain("Möhren");
  });

  test("no discounted products appear in the feed", async () => {
    // The price-only items in the fixture were discarded by the normalizer's both-price filter (D21).
    // Observable outcome: the discount feed is empty — no product names from the fixture appear.
    const response = await fetch(`http://localhost:${serverPort}/`);
    const html = await response.text();

    // Products from the price-only fixture must not appear
    expect(html).not.toContain("Kartoffeln");
    expect(html).not.toContain("Möhren");
    // The empty-state message must be present (user-visible outcome)
    expect(html).toContain("No discounts available this week");
  });
});
