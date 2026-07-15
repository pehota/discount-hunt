/**
 * Unit/integration test for DiscountHandler.handleGet
 *
 * Uses real SQLite in-memory DB (classical TDD integration pattern at hexagonal boundary).
 * DiscountService + SQLiteDiscountItemRepository are real — no mocks in the domain.
 * Test doubles would only appear at external port boundaries; none needed here.
 *
 * Behaviors under test (Mandate 1: 2 × 2 behaviors = 4 max; we use 2):
 *   B1: items present → HTML contains names and both prices per item + Generate Meal Plan button
 *   B2: no items → HTML contains "No discounts available this week" + Generate Meal Plan button
 */

import { describe, test, expect, beforeEach } from "bun:test";
import { createDb } from "../../shared/db.ts";
import { discountItems } from "../../shared/schema.ts";
import { SQLiteDiscountItemRepository } from "../adapters/sqlite-discount-item-repository.ts";
import { SQLiteScrapeJobRepository } from "../../scraping/adapters/sqlite-scrape-job-repository.ts";
import { DiscountService } from "../discount-service.ts";
import { DiscountHandler } from "./discount-handler.ts";
import { currentWeekMonday } from "../../shared/week.ts";

/** A validUntil comfortably inside the current week so getByWeek (validUntil >= Monday) keeps it. */
function thisWeekValidUntil(): string {
  const monday = new Date(`${currentWeekMonday()}T00:00:00.000Z`);
  monday.setUTCDate(monday.getUTCDate() + 6); // that week's Sunday
  return monday.toISOString().slice(0, 10);
}

function makeRequest(): Request {
  return new Request("http://localhost/");
}

describe("DiscountHandler.handleGet", () => {
  let handler: DiscountHandler;
  let discountService: DiscountService;
  let db: ReturnType<typeof createDb>;

  beforeEach(() => {
    db = createDb(":memory:");
    const repo = new SQLiteDiscountItemRepository(db);
    discountService = new DiscountService(repo);
    handler = new DiscountHandler(discountService);
  });

  test("B1: returns 200 HTML with item names and both prices when items exist", async () => {
    // Seed fixture mirroring walking-skeleton AT happy path
    await discountService.registerDiscountItem(
      {
        externalId: "item-001",
        store: "aldi",
        name: "Zucchini",
        category: "vegetable",
        regularPrice: 199, // cents
        salePrice: 99,     // cents
        validUntil: "2026-07-14",
        dietaryTags: ["vegan"],
      },
      "job-001"
    );
    await discountService.registerDiscountItem(
      {
        externalId: "item-002",
        store: "aldi",
        name: "Rote Linsen",
        category: "legume",
        regularPrice: 249,
        salePrice: 149,
        validUntil: "2026-07-14",
        dietaryTags: ["vegan"],
      },
      "job-001"
    );
    await discountService.registerDiscountItem(
      {
        externalId: "item-003",
        store: "aldi",
        name: "Spinat",
        category: "vegetable",
        regularPrice: 179,
        salePrice: 89,
        validUntil: "2026-07-14",
        dietaryTags: ["vegan"],
      },
      "job-001"
    );

    const response = await handler.handleGet(makeRequest());

    expect(response.status).toBe(200);
    const html = await response.text();

    // Item names
    expect(html).toContain("Zucchini");
    expect(html).toContain("Rote Linsen");
    expect(html).toContain("Spinat");

    // Both prices per item (cents → euros, 2 decimal places)
    expect(html).toContain("1.99"); // Zucchini regularPrice
    expect(html).toContain("0.99"); // Zucchini salePrice
    expect(html).toContain("2.49"); // Rote Linsen regularPrice
    expect(html).toContain("1.49"); // Rote Linsen salePrice
    expect(html).toContain("1.79"); // Spinat regularPrice
    expect(html).toContain("0.89"); // Spinat salePrice

    // No empty-state message
    expect(html).not.toContain("No discounts available this week");

    // Generate Meal Plan button always visible (US-01 AC)
    expect(html).toContain("Generate Meal Plan");

    // Selection form wraps the feed and posts to the generate route.
    expect(html).toMatch(/<form[^>]*action="\/plan\/generate"/);

    // Each item card carries an UNCHECKED itemIds checkbox with an associated label:
    // nothing is preselected. Extract item ids from the discount_items DB rows to assert
    // value= wiring.
    const seededIds = db.select().from(discountItems).all().map((r) => r.id);
    expect(seededIds).toHaveLength(3);
    for (const id of seededIds) {
      // Isolate this item's checkbox tag, then assert it is present (fails loud if the
      // regex missed the tag) AND carries no `checked` attribute (default-unchecked).
      const tag =
        html.match(new RegExp(`<input type="checkbox"[^>]*name="itemIds"[^>]*value="${id}"[^>]*>`))?.[0] ?? "";
      expect(tag).toContain(`value="${id}"`);
      expect(tag).not.toContain("checked");
      // an associated label references this checkbox by id (for="select-<id>")
      expect(html).toContain(`for="select-${id}"`);
      expect(html).toContain(`id="select-${id}"`);
    }
  });

  test("B2: returns 200 HTML with empty-state message and Generate Meal Plan button when no items exist", async () => {
    // No items seeded — empty DB

    const response = await handler.handleGet(makeRequest());

    expect(response.status).toBe(200);
    const html = await response.text();

    expect(html).toContain("No discounts available this week");
    expect(html).toContain("Generate Meal Plan");
  });

  test("B3: the selection form offers an Add-to-Shopping-List submit alongside Generate", async () => {
    // The #meal-plan-action section keeps Generate first, then a second submit that
    // formaction-overrides to /list/add so the SAME checked itemIds POST to the list.
    const response = await handler.handleGet(makeRequest());
    const html = await response.text();

    expect(html).toContain(`formaction="/list/add"`);
    expect(html).toContain("Add to Shopping List");
    // Generate remains present and unaltered.
    expect(html).toContain("Generate Meal Plan");
  });
});

/**
 * Multi-store filter-pills — server-rendered contract (client-side JS behavior is
 * verified in-browser by the orchestrator; here we assert the markup the JS binds to).
 * Covers BOTH render paths: fallback (no scrapeJobRepo) and store-context (with scrapeJobRepo).
 */
describe("DiscountHandler filter pills", () => {
  const VU = thisWeekValidUntil();

  async function seed(
    service: DiscountService,
    store: string,
    count: number,
    jobId: string,
  ): Promise<void> {
    for (let i = 0; i < count; i++) {
      await service.registerDiscountItem(
        {
          externalId: `${store}-${i}`,
          store,
          name: `${store} item ${i}`,
          category: "vegetable",
          regularPrice: 200 + i,
          salePrice: 100 + i,
          validUntil: VU,
          dietaryTags: ["vegan"],
        },
        jobId,
      );
    }
  }

  test("fallback path: All pill shows total, one pill per store with its count, default active = All", async () => {
    const db = createDb(":memory:");
    const service = new DiscountService(new SQLiteDiscountItemRepository(db));
    await seed(service, "Aldi Süd", 3, "job-a");
    await seed(service, "Edeka", 2, "job-e");
    const handler = new DiscountHandler(service); // no scrapeJobRepo → renderFallback

    const html = await (await handler.handleGet(new Request("http://localhost/"))).text();

    // All pill = total (3 + 2 = 5), marked active by default
    expect(html).toContain(`data-filter="__all__"`);
    expect(html).toMatch(/data-filter="__all__"[^>]*class="filter-pill active"|class="filter-pill active"[^>]*data-filter="__all__"/);
    expect(html).toContain(`aria-pressed="true"`);
    expect(html).toMatch(/All\s*<span class="pill-count">5<\/span>/);

    // Per-store pills carry their own counts
    expect(html).toContain(`data-filter="Aldi Süd"`);
    expect(html).toMatch(/Aldi Süd\s*<span class="pill-count">3<\/span>/);
    expect(html).toContain(`data-filter="Edeka"`);
    expect(html).toMatch(/Edeka\s*<span class="pill-count">2<\/span>/);

    // Sections tagged with data-store so the client filter can target them
    expect(html).toContain(`data-store="Aldi Süd"`);
    expect(html).toContain(`data-store="Edeka"`);

    // Status line defaults to All
    expect(html).toContain("Showing: All (5)");
  });

  test("store-context path: pills + counts + data-store present when scrapeJobRepo is wired", async () => {
    const db = createDb(":memory:");
    const service = new DiscountService(new SQLiteDiscountItemRepository(db));
    const jobRepo = new SQLiteScrapeJobRepository(db);

    // Real completed jobs → renderWithStoreContext path (recent completed = no staleness warning)
    const jobA = await jobRepo.startJob("Aldi Süd");
    await seed(service, "Aldi Süd", 4, jobA);
    await jobRepo.completeJob(jobA, 4);
    const jobE = await jobRepo.startJob("Edeka");
    await seed(service, "Edeka", 1, jobE);
    await jobRepo.completeJob(jobE, 1);

    const handler = new DiscountHandler(service, jobRepo);
    const html = await (await handler.handleGet(new Request("http://localhost/"))).text();

    // All total = 5, default active
    expect(html).toMatch(/All\s*<span class="pill-count">5<\/span>/);
    expect(html).toContain(`aria-current="true"`);
    // Per-store counts
    expect(html).toMatch(/Aldi Süd\s*<span class="pill-count">4<\/span>/);
    expect(html).toMatch(/Edeka\s*<span class="pill-count">1<\/span>/);
    // data-store on the store-group sections (store-context path)
    expect(html).toContain(`data-store="Aldi Süd"`);
    expect(html).toContain(`data-store="Edeka"`);
    expect(html).not.toContain("may be outdated"); // fresh jobs → no staleness warning
  });

  test("empty-state store gets a data-store section but NO pill (pills require >=1 item)", async () => {
    const db = createDb(":memory:");
    const service = new DiscountService(new SQLiteDiscountItemRepository(db));
    const jobRepo = new SQLiteScrapeJobRepository(db);

    // Store with items
    const jobA = await jobRepo.startJob("Aldi Süd");
    await seed(service, "Aldi Süd", 2, jobA);
    await jobRepo.completeJob(jobA, 2);
    // Store with a completed job but ZERO items → empty-state section
    const jobV = await jobRepo.startJob("V-Markt");
    await jobRepo.completeJob(jobV, 0);

    const handler = new DiscountHandler(service, jobRepo);
    const html = await (await handler.handleGet(new Request("http://localhost/"))).text();

    // Empty store: section tagged, but no pill for it
    expect(html).toContain(`data-store="V-Markt"`);
    expect(html).toContain("No discounts this week at V-Markt");
    expect(html).not.toContain(`data-filter="V-Markt"`);
    // All total reflects only real items (2)
    expect(html).toMatch(/All\s*<span class="pill-count">2<\/span>/);
  });
});

/**
 * Feed enhancements — server-rendered contract for the client-side search box and
 * the selection-overview container. The interactive behavior (live filtering,
 * cross-store aggregation, deselect-from-overview) is verified in-browser by the
 * orchestrator; here we assert ONLY the static markup the unified controller binds to.
 *
 * Covers both render paths: store-context (with scrapeJobRepo + completed jobs) and
 * fallback (no scrapeJobRepo).
 */
describe("DiscountHandler feed enhancements", () => {
  const VU = thisWeekValidUntil();

  async function seed(
    service: DiscountService,
    store: string,
    count: number,
    jobId: string,
  ): Promise<void> {
    for (let i = 0; i < count; i++) {
      await service.registerDiscountItem(
        {
          externalId: `${store}-${i}`,
          store,
          name: `${store} item ${i}`,
          category: "vegetable",
          regularPrice: 200 + i,
          salePrice: 100 + i,
          validUntil: VU,
          dietaryTags: ["vegan"],
        },
        jobId,
      );
    }
  }

  test("store-context path: accessible search input with an associated label is rendered", async () => {
    const db = createDb(":memory:");
    const service = new DiscountService(new SQLiteDiscountItemRepository(db));
    const jobRepo = new SQLiteScrapeJobRepository(db);
    const jobA = await jobRepo.startJob("Aldi Süd");
    await seed(service, "Aldi Süd", 2, jobA);
    await jobRepo.completeJob(jobA, 2);

    const handler = new DiscountHandler(service, jobRepo);
    const html = await (await handler.handleGet(new Request("http://localhost/"))).text();

    // A search input carrying id (its accessible name comes from the linked label).
    expect(html).toMatch(/<input[^>]*type="search"[^>]*id="feed-search-input"|<input[^>]*id="feed-search-input"[^>]*type="search"/);
    // A <label> whose for= links to the input id, giving it an accessible name.
    expect(html).toMatch(/<label[^>]*for="feed-search-input"[^>]*>\s*Search products\s*<\/label>/);
  });

  test("store-context path: selection-overview container with a live count node and list is rendered", async () => {
    const db = createDb(":memory:");
    const service = new DiscountService(new SQLiteDiscountItemRepository(db));
    const jobRepo = new SQLiteScrapeJobRepository(db);
    const jobA = await jobRepo.startJob("Aldi Süd");
    await seed(service, "Aldi Süd", 3, jobA);
    await jobRepo.completeJob(jobA, 3);

    const handler = new DiscountHandler(service, jobRepo);
    const html = await (await handler.handleGet(new Request("http://localhost/"))).text();

    // Overview container present.
    expect(html).toMatch(/<section[^>]*class="selection-overview"/);
    // Live count node: aria-live="polite" and initial "Selected (0)" text server-side.
    expect(html).toMatch(/<span[^>]*class="selection-overview-count"[^>]*aria-live="polite"[^>]*>\s*Selected \(0\)\s*<\/span>|<span[^>]*aria-live="polite"[^>]*class="selection-overview-count"[^>]*>\s*Selected \(0\)\s*<\/span>/);
    // The overview list container exists (empty by default; JS populates it).
    expect(html).toMatch(/<ul[^>]*id="selection-overview-list"/);
    // Hidden empty-state node the JS toggles.
    expect(html).toMatch(/<p[^>]*class="no-match-state"[^>]*hidden/);
  });

  test("fallback path: search input + selection-overview also render without scrapeJobRepo", async () => {
    const db = createDb(":memory:");
    const service = new DiscountService(new SQLiteDiscountItemRepository(db));
    await seed(service, "Edeka", 2, "job-e");

    const handler = new DiscountHandler(service); // no scrapeJobRepo → fallback path
    const html = await (await handler.handleGet(new Request("http://localhost/"))).text();

    expect(html).toMatch(/<input[^>]*id="feed-search-input"/);
    expect(html).toMatch(/<label[^>]*for="feed-search-input"[^>]*>\s*Search products\s*<\/label>/);
    expect(html).toMatch(/<section[^>]*class="selection-overview"/);
    expect(html).toMatch(/Selected \(0\)/);
    expect(html).toMatch(/<ul[^>]*id="selection-overview-list"/);
  });
});
