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
import { SQLiteShoppingListRepository } from "../../shopping-list/adapters/sqlite-shopping-list-repository.ts";
import { ShoppingListService } from "../../shopping-list/shopping-list-service.ts";
import { currentWeekMonday } from "../../shared/week.ts";
import { TAXONOMY_CATEGORIES } from "../../shared/types.ts";
import type { TaxonomyCategory, Tag } from "../../shared/types.ts";
import { escapeHtml } from "../../shared/html.ts";

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
        sourceUrl: null,
        imageUrl: null,
        brand: null,
        description: null,
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
        sourceUrl: null,
        imageUrl: null,
        brand: null,
        description: null,
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
        sourceUrl: null,
        imageUrl: null,
        brand: null,
        description: null,
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

    // Selection form wraps the feed and posts to the generate route in DRAFT mode (D2):
    // the "Generate Meal Plan" button produces a throwaway real-recipe draft, not an auto-save.
    expect(html).toMatch(/<form[^>]*action="\/plan\/generate\?draft=true"/);

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
          sourceUrl: null,
          imageUrl: null,
          brand: null,
          description: null,
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
          sourceUrl: null,
          imageUrl: null,
          brand: null,
          description: null,
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

/**
 * Feed action-hub — server-rendered contract for the selection-overview action
 * buttons and the toast live-region. These are STATIC markup (present at load),
 * bound/enhanced by the inline controller. The interactive fetch+toast flow is
 * verified in-browser by the orchestrator; here we assert ONLY the static markup.
 *
 * # bypass: single-shot server-rendered markup contract (class + label + role),
 * not an equivalence-class invariant — property-framing adds no coverage.
 */
describe("DiscountHandler feed action-hub", () => {
  const VU = thisWeekValidUntil();

  async function seed(service: DiscountService, store: string, count: number, jobId: string): Promise<void> {
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
          sourceUrl: null,
          imageUrl: null,
          brand: null,
          description: null,
        },
        jobId,
      );
    }
  }

  test("overview renders TWO static action buttons (add + generate) with stable classes, disabled at load", async () => {
    const db = createDb(":memory:");
    const service = new DiscountService(new SQLiteDiscountItemRepository(db));
    await seed(service, "Edeka", 2, "job-e");

    const handler = new DiscountHandler(service);
    const html = await (await handler.handleGet(new Request("http://localhost/"))).text();

    // Add-to-list overview action: stable class + label, starts disabled (count 0).
    const addBtn = html.match(/<button[^>]*class="selection-overview-add"[^>]*>[^<]*<\/button>/)?.[0] ?? "";
    expect(addBtn).toContain("selection-overview-add");
    expect(addBtn).toContain("Add to Shopping List");
    expect(addBtn).toContain("disabled");

    // Generate-meal-plan overview action: stable class + label, starts disabled.
    const genBtn = html.match(/<button[^>]*class="selection-overview-generate"[^>]*>[^<]*<\/button>/)?.[0] ?? "";
    expect(genBtn).toContain("selection-overview-generate");
    expect(genBtn).toContain("Generate Meal Plan");
    expect(genBtn).toContain("disabled");

    // Both overview buttons live inside the .selection-overview <section>.
    const overview = html.match(/<section[^>]*class="selection-overview"[\s\S]*?<\/section>/)?.[0] ?? "";
    expect(overview).toContain("selection-overview-add");
    expect(overview).toContain("selection-overview-generate");

    // Native #meal-plan-action buttons remain the no-JS baseline (distinct, still present).
    expect(html).toContain(`formaction="/list/add"`);
    expect(html).toContain(`id="generate-meal-plan"`);
  });

  test("feed body carries a toast live-region (role=status, feed-toast class, hidden at load)", async () => {
    const db = createDb(":memory:");
    const service = new DiscountService(new SQLiteDiscountItemRepository(db));
    await seed(service, "Edeka", 1, "job-e");

    const handler = new DiscountHandler(service);
    const html = await (await handler.handleGet(new Request("http://localhost/"))).text();

    const toast = html.match(/<div[^>]*class="feed-toast"[^>]*>|<div[^>]*feed-toast[^>]*>/)?.[0] ?? "";
    expect(toast).toContain("feed-toast");
    expect(toast).toContain(`role="status"`);
    expect(toast).toContain(`aria-live="polite"`);
    expect(toast).toContain("hidden");
  });

  // The feed passes the injected ShoppingListService's current-week count as listCount →
  // the shared nav renders a list badge. Without the service, no badge (default 0).
  test("injected ShoppingListService count renders the list nav badge on the feed", async () => {
    const db = createDb(":memory:");
    const service = new DiscountService(new SQLiteDiscountItemRepository(db));
    await seed(service, "Edeka", 1, "job-e");
    const listService = new ShoppingListService(new SQLiteShoppingListRepository(db), service);
    listService.addManualItem("Bread", 149);
    listService.addManualItem("Milk", 99);

    const handler = new DiscountHandler(service, undefined, undefined, listService);
    const html = await (await handler.handleGet(new Request("http://localhost/"))).text();

    const listAnchor = html.match(/<a[^>]*href="\/list"[\s\S]*?<\/a>/)?.[0] ?? "";
    expect(listAnchor).toMatch(/<span class="nav-badge" data-nav-badge>2<\/span>/);
  });

  test("no ShoppingListService → no list nav badge on the feed", async () => {
    const db = createDb(":memory:");
    const service = new DiscountService(new SQLiteDiscountItemRepository(db));
    await seed(service, "Edeka", 1, "job-e");

    const handler = new DiscountHandler(service);
    const html = await (await handler.handleGet(new Request("http://localhost/"))).text();
    // Scope to the /list nav anchor: the inline FILTER_SCRIPT references data-nav-badge
    // as a string literal (create-on-add path), so a page-wide substring check is invalid.
    const listAnchor = html.match(/<a[^>]*href="\/list"[\s\S]*?<\/a>/)?.[0] ?? "";
    expect(listAnchor).not.toContain("nav-badge");
  });
});

/**
 * Category filter (3rd additive dimension) + price-ascending sort — server-rendered
 * contract. The client-side additive filtering behavior (store × name × category) is
 * browser-verified by the orchestrator; here we assert ONLY the markup the JS binds to:
 * the category pill group (canonical order + counts + distinct data-category attr), the
 * per-card data-category attribute, and the price-asc DOM order within a store group.
 *
 * Category counts are GLOBAL (over the whole feed), not per-store. NULL taxonomy → "Other".
 * TAXONOMY_CATEGORIES is the SSOT for order + membership — never re-list the literals here.
 */
describe("DiscountHandler category filter + price-asc sort", () => {
  const VU = thisWeekValidUntil();

  /**
   * Seed one item and persist its taxonomy_category via the repo's single-writer port
   * (setCategorisation). id is derived as `${store}:${externalId}`. category=null seeds
   * an uncategorised (pending) row → renders under the "Other" bucket.
   */
  async function seedItem(
    service: DiscountService,
    repo: SQLiteDiscountItemRepository,
    opts: { store: string; externalId: string; name: string; salePrice: number; category: TaxonomyCategory | null; jobId: string; tags?: Tag[]; sourceUrl?: string | null; imageUrl?: string | null; brand?: string | null; description?: string | null },
  ): Promise<void> {
    await service.registerDiscountItem(
      {
        externalId: opts.externalId,
        store: opts.store,
        name: opts.name,
        category: "vegetable",
        regularPrice: opts.salePrice + 100,
        salePrice: opts.salePrice,
        validUntil: VU,
        dietaryTags: ["vegan"],
        sourceUrl: opts.sourceUrl ?? null,
        imageUrl: opts.imageUrl ?? null,
        brand: opts.brand ?? null,
        description: opts.description ?? null,
      },
      opts.jobId,
    );
    if (opts.category !== null) {
      repo.setCategorisation(`${opts.store}:${opts.externalId}`, opts.category, opts.tags ?? []);
    }
  }

  test("category pills render in TAXONOMY_CATEGORIES order, only for present categories, with global counts", async () => {
    const db = createDb(":memory:");
    const repo = new SQLiteDiscountItemRepository(db);
    const service = new DiscountService(repo);
    // Present categories span two stores → counts must be GLOBAL, not per-store.
    // "Meat & Fish" ×2 (across stores), "Produce" ×1, and one NULL → "Other" ×1.
    await seedItem(service, repo, { store: "Aldi", externalId: "a1", name: "Steak", salePrice: 500, category: "Meat & Fish", jobId: "j" });
    await seedItem(service, repo, { store: "Edeka", externalId: "e1", name: "Salmon", salePrice: 400, category: "Meat & Fish", jobId: "j" });
    await seedItem(service, repo, { store: "Aldi", externalId: "a2", name: "Apple", salePrice: 100, category: "Produce", jobId: "j" });
    await seedItem(service, repo, { store: "Edeka", externalId: "e2", name: "Mystery", salePrice: 200, category: null, jobId: "j" });

    const handler = new DiscountHandler(service);
    const html = await (await handler.handleGet(new Request("http://localhost/"))).text();

    // Distinct category pill group with its own aria-label + container class.
    expect(html).toMatch(/<div[^>]*class="category-filter-pills"[^>]*aria-label="Filter deals by category"|<div[^>]*aria-label="Filter deals by category"[^>]*class="category-filter-pills"/);
    // "All" pill uses the SAME sentinel but the category dimension attribute (data-category).
    expect(html).toContain(`data-category="__all__"`);
    // Global counts: category names escaped ("&" → "&amp;").
    expect(html).toMatch(new RegExp(`data-category="${escapeHtml("Meat & Fish")}"[^>]*>${escapeHtml("Meat & Fish")}\\s*<span class="pill-count">2</span>`));
    expect(html).toMatch(/data-category="Produce"[^>]*>Produce\s*<span class="pill-count">1<\/span>/);
    // NULL taxonomy tallied under the "Other" pill.
    expect(html).toMatch(/data-category="Other"[^>]*>Other\s*<span class="pill-count">1<\/span>/);

    // Absent categories emit NO pill.
    expect(html).not.toContain(`data-category="Bakery"`);
    expect(html).not.toContain(`data-category="Household"`);

    // Canonical order: only assert the ORDER of the pills that are present. Scope to the
    // category pill GROUP (cards also carry data-category), extract the pill values
    // (skipping the __all__ sentinel) and compare to the SSOT-filtered order.
    const pillGroup = html.match(/<div[^>]*class="category-filter-pills"[\s\S]*?<\/div>/)?.[0] ?? "";
    const rendered = Array.from(pillGroup.matchAll(/data-category="([^"]+)"/g))
      .map((m) => m[1])
      .filter((c): c is string => c !== undefined && c !== "__all__");
    const presentInCanonicalOrder = TAXONOMY_CATEGORIES
      .filter((c) => rendered.includes(escapeHtml(c)))
      .map((c) => escapeHtml(c));
    expect(rendered).toEqual(presentInCanonicalOrder);
  });

  test("each card carries data-category; NULL taxonomy → Other", async () => {
    const db = createDb(":memory:");
    const repo = new SQLiteDiscountItemRepository(db);
    const service = new DiscountService(repo);
    await seedItem(service, repo, { store: "Aldi", externalId: "a1", name: "Apple", salePrice: 100, category: "Produce", jobId: "j" });
    await seedItem(service, repo, { store: "Aldi", externalId: "a2", name: "Mystery", salePrice: 200, category: null, jobId: "j" });

    const handler = new DiscountHandler(service);
    const html = await (await handler.handleGet(new Request("http://localhost/"))).text();

    // The categorised card carries its bucket; the NULL card falls back to "Other".
    const appleCard = html.match(/<div class="card"[^>]*>[\s\S]*?Apple/)?.[0] ?? "";
    expect(appleCard).toContain(`data-category="Produce"`);
    const mysteryCard = html.match(/<div class="card"[^>]*>[\s\S]*?Mystery/)?.[0] ?? "";
    expect(mysteryCard).toContain(`data-category="Other"`);
  });

  test("card data-category escapes ampersand categories", async () => {
    const db = createDb(":memory:");
    const repo = new SQLiteDiscountItemRepository(db);
    const service = new DiscountService(repo);
    await seedItem(service, repo, { store: "Aldi", externalId: "a1", name: "Steak", salePrice: 500, category: "Meat & Fish", jobId: "j" });

    const handler = new DiscountHandler(service);
    const html = await (await handler.handleGet(new Request("http://localhost/"))).text();

    // Both the card attr and the pill use the escaped form → they match under getAttribute() in-browser.
    expect(html).toContain(`data-category="${escapeHtml("Meat & Fish")}"`);
    expect(html).not.toMatch(/data-category="Meat & Fish"/); // raw ampersand must NOT appear
  });

  test("within a store group, cards render in ascending salePrice order (default order)", async () => {
    const db = createDb(":memory:");
    const repo = new SQLiteDiscountItemRepository(db);
    const service = new DiscountService(repo);
    // Seed DESCENDING so a broken/no-op sort would fail: cheapest ("Cheap", 100) must
    // end up first in the DOM despite being registered last.
    await seedItem(service, repo, { store: "Aldi", externalId: "a1", name: "Expensive", salePrice: 900, category: "Produce", jobId: "j" });
    await seedItem(service, repo, { store: "Aldi", externalId: "a2", name: "Medium", salePrice: 500, category: "Produce", jobId: "j" });
    await seedItem(service, repo, { store: "Aldi", externalId: "a3", name: "Cheap", salePrice: 100, category: "Produce", jobId: "j" });

    const handler = new DiscountHandler(service);
    const html = await (await handler.handleGet(new Request("http://localhost/"))).text();

    const cheapIdx = html.indexOf("Cheap");
    const mediumIdx = html.indexOf("Medium");
    const expensiveIdx = html.indexOf("Expensive");
    expect(cheapIdx).toBeGreaterThan(-1);
    expect(cheapIdx).toBeLessThan(mediumIdx);
    expect(mediumIdx).toBeLessThan(expensiveIdx);
  });

  test("price-asc sort does NOT corrupt store pill counts (copy sorted, not the shared group)", async () => {
    const db = createDb(":memory:");
    const repo = new SQLiteDiscountItemRepository(db);
    const service = new DiscountService(repo);
    await seedItem(service, repo, { store: "Aldi", externalId: "a1", name: "Expensive", salePrice: 900, category: "Produce", jobId: "j" });
    await seedItem(service, repo, { store: "Aldi", externalId: "a2", name: "Cheap", salePrice: 100, category: "Produce", jobId: "j" });

    const handler = new DiscountHandler(service);
    const html = await (await handler.handleGet(new Request("http://localhost/"))).text();

    // Aldi store pill still counts both items.
    expect(html).toMatch(/data-filter="Aldi"[^>]*>Aldi\s*<span class="pill-count">2<\/span>/);
  });

  test("a card WITH tags carries lowercased data-tags and one .card-tag chip per tag (original casing)", async () => {
    const db = createDb(":memory:");
    const repo = new SQLiteDiscountItemRepository(db);
    const service = new DiscountService(repo);
    await seedItem(service, repo, {
      store: "Aldi", externalId: "a1", name: "Bio Lachs TK", salePrice: 500,
      category: "Meat & Fish", jobId: "j", tags: ["Frozen", "Organic"],
    });

    const handler = new DiscountHandler(service);
    const html = await (await handler.handleGet(new Request("http://localhost/"))).text();

    const card = html.match(/<div class="card"[^>]*>[\s\S]*?Bio Lachs TK[\s\S]*?<\/div>\s*<\/div>/)?.[0] ?? "";
    // data-tags: lowercased, space-joined, on the .card element.
    expect(card).toContain(`data-tags="frozen organic"`);
    // One chip per tag, ORIGINAL casing, inside a .card-tags container.
    expect(card).toContain(`<span class="card-tag">Frozen</span>`);
    expect(card).toContain(`<span class="card-tag">Organic</span>`);
    expect(card).toContain(`class="card-tags"`);
    // Chips are OUTSIDE .item-name (search reads the attribute, not chip text).
    expect(card).not.toMatch(/<h3 class="item-name">[^<]*card-tag/);
  });

  test("a card with NO tags has empty data-tags and NO .card-tag elements", async () => {
    const db = createDb(":memory:");
    const repo = new SQLiteDiscountItemRepository(db);
    const service = new DiscountService(repo);
    await seedItem(service, repo, {
      store: "Aldi", externalId: "a1", name: "Apple", salePrice: 100, category: "Produce", jobId: "j",
    });

    const handler = new DiscountHandler(service);
    const html = await (await handler.handleGet(new Request("http://localhost/"))).text();

    const card = html.match(/<div class="card"[^>]*>[\s\S]*?Apple[\s\S]*?<\/div>\s*<\/div>/)?.[0] ?? "";
    expect(card).toContain(`data-tags=""`);
    expect(card).not.toContain("card-tag");
  });

  // ── Feature A: in-card store chip ─────────────────────────────────────────

  test("A: each card renders a .card-store chip with the store name, distinct from .card-tag and OUTSIDE .item-name", async () => {
    const db = createDb(":memory:");
    const repo = new SQLiteDiscountItemRepository(db);
    const service = new DiscountService(repo);
    await seedItem(service, repo, { store: "Aldi", externalId: "a1", name: "Zucchini", salePrice: 100, category: "Produce", jobId: "j" });

    const handler = new DiscountHandler(service);
    const html = await (await handler.handleGet(new Request("http://localhost/"))).text();

    const card = html.match(/<div class="card"[^>]*>[\s\S]*?Zucchini[\s\S]*?<\/div>\s*<\/div>/)?.[0] ?? "";
    // The chip carries the store name and its own distinct class (not .card-tag).
    expect(card).toContain(`<span class="card-store">Aldi</span>`);
    // The store chip must NOT be inside .item-name (would pollute the searchable product name).
    expect(card).not.toMatch(/<h3 class="item-name">[^<]*card-store/);
  });

  // ── Feature B: product name links to the original offer in a new tab ──────

  test("B: name links to sourceUrl in a new tab; anchor is inside .item-name but OUTSIDE the label; textContent stays the product name", async () => {
    const url = "https://www.marktguru.de/offers/42";
    const db = createDb(":memory:");
    const repo = new SQLiteDiscountItemRepository(db);
    const service = new DiscountService(repo);
    await seedItem(service, repo, { store: "Edeka", externalId: "e1", name: "Bauernbrot", salePrice: 149, category: "Bakery", jobId: "j", sourceUrl: url });

    const handler = new DiscountHandler(service);
    const html = await (await handler.handleGet(new Request("http://localhost/"))).text();

    const card = html.match(/<div class="card"[^>]*>[\s\S]*?Bauernbrot[\s\S]*?<\/div>\s*<\/div>/)?.[0] ?? "";

    // The item-name is an <h3 class="item-name"> wrapping an anchor to the escaped sourceUrl.
    const itemName = card.match(/<h3 class="item-name">[\s\S]*?<\/h3>/)?.[0] ?? "";
    expect(itemName).toContain(`href="${url}"`);
    expect(itemName).toContain(`target="_blank"`);
    expect(itemName).toContain(`rel="noopener`);
    // textContent of .item-name is EXACTLY the product name — no affordance leaked into the DOM text.
    const innerText = itemName.replace(/<[^>]*>/g, "").trim();
    expect(innerText).toBe("Bauernbrot");
    expect(innerText).not.toContain("↗");

    // The anchor lives OUTSIDE the .card-select label (label must not wrap the link).
    const label = card.match(/<label class="card-select"[\s\S]*?<\/label>/)?.[0] ?? "";
    expect(label).not.toContain("<a ");
  });

  test("C: when sourceUrl is null, .item-name wraps a modal-trigger button (NO anchor); textContent stays the product name", async () => {
    const db = createDb(":memory:");
    const repo = new SQLiteDiscountItemRepository(db);
    const service = new DiscountService(repo);
    await seedItem(service, repo, { store: "Aldi", externalId: "a1", name: "Zucchini", salePrice: 100, category: "Produce", jobId: "j", sourceUrl: null });

    const handler = new DiscountHandler(service);
    const html = await (await handler.handleGet(new Request("http://localhost/"))).text();

    const card = html.match(/<div class="card"[^>]*>[\s\S]*?Zucchini[\s\S]*?<\/div>\s*<\/div>/)?.[0] ?? "";
    const itemName = card.match(/<h3 class="item-name">[\s\S]*?<\/h3>/)?.[0] ?? "";
    // Null case → a <button class="item-name-trigger"> that opens the modal; NO anchor.
    expect(itemName).toContain(`<button type="button" class="item-name-trigger">`);
    expect(itemName).not.toContain("<a ");
    // LOAD-BEARING CONTRACT: .item-name textContent === EXACTLY the product name.
    expect(itemName.replace(/<[^>]*>/g, "").trim()).toBe("Zucchini");
  });

  test("D: a non-http sourceUrl (javascript:) is NOT linked — plain text, no anchor", async () => {
    const db = createDb(":memory:");
    const repo = new SQLiteDiscountItemRepository(db);
    const service = new DiscountService(repo);
    await seedItem(service, repo, { store: "Aldi", externalId: "a1", name: "Zucchini", salePrice: 100, category: "Produce", jobId: "j", sourceUrl: "javascript:alert(1)" });

    const handler = new DiscountHandler(service);
    const html = await (await handler.handleGet(new Request("http://localhost/"))).text();

    const card = html.match(/<div class="card"[^>]*>[\s\S]*?Zucchini[\s\S]*?<\/div>\s*<\/div>/)?.[0] ?? "";
    const itemName = card.match(/<h3 class="item-name">[\s\S]*?<\/h3>/)?.[0] ?? "";
    expect(itemName).not.toContain("<a ");
    expect(itemName).not.toContain("javascript:");
    expect(itemName.replace(/<[^>]*>/g, "").trim()).toBe("Zucchini");
  });
});

/**
 * Product-details modal — server-rendered scaffolding contract. Clicking a product name
 * opens a dialog with the item's image + details (client JS, browser-verified by the
 * orchestrator). Here we assert ONLY the static markup the client JS reads/populates:
 * the per-card data-* payload (escaped) and the one hidden .product-modal template.
 */
describe("DiscountHandler product-details modal", () => {
  const VU = thisWeekValidUntil();

  async function seedItem(
    service: DiscountService,
    repo: SQLiteDiscountItemRepository,
    opts: { store: string; externalId: string; name: string; salePrice: number; category: TaxonomyCategory | null; jobId: string; sourceUrl?: string | null; imageUrl?: string | null; brand?: string | null; description?: string | null },
  ): Promise<void> {
    await service.registerDiscountItem(
      {
        externalId: opts.externalId,
        store: opts.store,
        name: opts.name,
        category: "vegetable",
        regularPrice: opts.salePrice + 100,
        salePrice: opts.salePrice,
        validUntil: VU,
        dietaryTags: ["vegan"],
        sourceUrl: opts.sourceUrl ?? null,
        imageUrl: opts.imageUrl ?? null,
        brand: opts.brand ?? null,
        description: opts.description ?? null,
      },
      opts.jobId,
    );
    if (opts.category !== null) {
      repo.setCategorisation(`${opts.store}:${opts.externalId}`, opts.category, []);
    }
  }

  test("each card carries data-image / data-brand / data-desc with the seeded values", async () => {
    const db = createDb(":memory:");
    const repo = new SQLiteDiscountItemRepository(db);
    const service = new DiscountService(repo);
    await seedItem(service, repo, {
      store: "Aldi", externalId: "a1", name: "Zucchini", salePrice: 100, category: "Produce", jobId: "j",
      imageUrl: "https://cdn.example.com/zucchini.jpg", brand: "BioAldi", description: "Fresh green zucchini",
    });

    const handler = new DiscountHandler(service);
    const html = await (await handler.handleGet(new Request("http://localhost/"))).text();

    const card = html.match(/<div class="card"[^>]*>/)?.[0] ?? "";
    expect(card).toContain(`data-image="https://cdn.example.com/zucchini.jpg"`);
    expect(card).toContain(`data-brand="BioAldi"`);
    expect(card).toContain(`data-desc="Fresh green zucchini"`);
  });

  test("null image/brand/description render as empty data-* attributes (no 'null' leak)", async () => {
    const db = createDb(":memory:");
    const repo = new SQLiteDiscountItemRepository(db);
    const service = new DiscountService(repo);
    await seedItem(service, repo, { store: "Aldi", externalId: "a1", name: "Zucchini", salePrice: 100, category: "Produce", jobId: "j" });

    const handler = new DiscountHandler(service);
    const html = await (await handler.handleGet(new Request("http://localhost/"))).text();

    const card = html.match(/<div class="card"[^>]*>/)?.[0] ?? "";
    expect(card).toContain(`data-image=""`);
    expect(card).toContain(`data-brand=""`);
    expect(card).toContain(`data-desc=""`);
  });

  test("data-* attribute values with quote/angle-bracket chars are HTML-escaped", async () => {
    const db = createDb(":memory:");
    const repo = new SQLiteDiscountItemRepository(db);
    const service = new DiscountService(repo);
    const desc = `Big "quote" & <script>alert(1)</script>`;
    await seedItem(service, repo, { store: "Aldi", externalId: "a1", name: "Zucchini", salePrice: 100, category: "Produce", jobId: "j", description: desc });

    const handler = new DiscountHandler(service);
    const html = await (await handler.handleGet(new Request("http://localhost/"))).text();

    const card = html.match(/<div class="card"[^>]*>/)?.[0] ?? "";
    // The attribute holds the fully-escaped form; the raw dangerous chars must NOT appear in it.
    expect(card).toContain(`data-desc="${escapeHtml(desc)}"`);
    expect(card).not.toContain(`data-desc="Big "quote"`);
    expect(card).not.toContain("<script>alert(1)</script>");
  });

  test("the page renders exactly one hidden .product-modal dialog template", async () => {
    const db = createDb(":memory:");
    const repo = new SQLiteDiscountItemRepository(db);
    const service = new DiscountService(repo);
    await seedItem(service, repo, { store: "Aldi", externalId: "a1", name: "Zucchini", salePrice: 100, category: "Produce", jobId: "j" });

    const handler = new DiscountHandler(service);
    const html = await (await handler.handleGet(new Request("http://localhost/"))).text();

    const modal = html.match(/<div class="product-modal"[^>]*>/)?.[0] ?? "";
    expect(modal).toContain("product-modal");
    expect(modal).toContain("hidden");
    expect(modal).toContain(`role="dialog"`);
    expect(modal).toContain(`aria-modal="true"`);
    // Exactly one modal instance (rendered once as a body sibling, not per card).
    expect(html.match(/class="product-modal"/g)?.length).toBe(1);
    // Slots the client JS populates + the in-dialog offer link are present.
    expect(html).toContain(`class="pm-title"`);
    expect(html).toContain(`class="pm-offer`);
    expect(html).toContain("View original offer");
  });

  test("linkable name → <a href> (no-JS offer fallback); non-linkable → item-name-trigger button", async () => {
    const db = createDb(":memory:");
    const repo = new SQLiteDiscountItemRepository(db);
    const service = new DiscountService(repo);
    await seedItem(service, repo, { store: "Edeka", externalId: "e1", name: "Bauernbrot", salePrice: 149, category: "Bakery", jobId: "j", sourceUrl: "https://example.com/o/1" });
    await seedItem(service, repo, { store: "Aldi", externalId: "a1", name: "Zucchini", salePrice: 100, category: "Produce", jobId: "j", sourceUrl: null });

    const handler = new DiscountHandler(service);
    const html = await (await handler.handleGet(new Request("http://localhost/"))).text();

    // Scope each name to its own store section (both cards live on the same page).
    const edekaSection = html.match(/<section class="store-group" data-store="Edeka">[\s\S]*?<\/section>/)?.[0] ?? "";
    const linkName = edekaSection.match(/<h3 class="item-name">[\s\S]*?<\/h3>/)?.[0] ?? "";
    expect(linkName).toContain(`<a href="https://example.com/o/1"`);
    expect(linkName).not.toContain("item-name-trigger");
    expect(linkName.replace(/<[^>]*>/g, "").trim()).toBe("Bauernbrot");

    const aldiSection = html.match(/<section class="store-group" data-store="Aldi">[\s\S]*?<\/section>/)?.[0] ?? "";
    const buttonName = aldiSection.match(/<h3 class="item-name">[\s\S]*?<\/h3>/)?.[0] ?? "";
    expect(buttonName).toContain(`<button type="button" class="item-name-trigger">`);
    expect(buttonName).not.toContain("<a ");
    expect(buttonName.replace(/<[^>]*>/g, "").trim()).toBe("Zucchini");
  });
});
