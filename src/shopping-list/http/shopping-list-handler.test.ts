/**
 * Integration test for ShoppingListHandler — the primary HTTP adapter for the list.
 *
 * Real service + real SQLite repos + real DiscountService (classical TDD across the
 * hexagon boundary). Requests are real Request objects; responses assert status +
 * rendered HTML markers. Discount items seeded via SQLiteDiscountItemRepository.register.
 *
 * # bypass: server-rendered-HTML + HTTP-status contract with exact markers (303 Location,
 * total/savings spans, empty-state, forms). Single-shot rendering + redirect contracts,
 * not equivalence-class invariants — property-framing adds no coverage.
 *
 * Behaviors:
 *   B1: GET /list renders items, running total, total savings, and the manual-add form
 *   B2: GET /list empty state when no items
 *   B3: POST /list/add via itemIds → 303 → /list, then items appear on GET
 *   B4: POST /list/add via name(+price) → 303, manual row appears
 *   B5: POST /list/remove → 303, the row is gone
 *   B6: no-op add and no-op remove both 303
 */

import { describe, test, expect, beforeEach } from "bun:test";
import { createDb } from "../../shared/db.ts";
import { SQLiteDiscountItemRepository } from "../../discount/adapters/sqlite-discount-item-repository.ts";
import { DiscountService } from "../../discount/discount-service.ts";
import { SQLiteShoppingListRepository } from "../adapters/sqlite-shopping-list-repository.ts";
import { ShoppingListService } from "../shopping-list-service.ts";
import { ShoppingListHandler } from "./shopping-list-handler.ts";
import { currentWeekMonday } from "../../shared/week.ts";
import { TAXONOMY_CATEGORIES } from "../../shared/types.ts";

function thisWeekValidUntil(): string {
  const monday = new Date(`${currentWeekMonday()}T00:00:00.000Z`);
  monday.setUTCDate(monday.getUTCDate() + 6);
  return monday.toISOString().slice(0, 10);
}

function postForm(path: string, body: string, headers?: Record<string, string>): Request {
  return new Request(`http://localhost${path}`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", ...headers },
    body,
  });
}

async function bodyText(response: Response): Promise<string> {
  return await response.text();
}

describe("ShoppingListHandler", () => {
  let handler: ShoppingListHandler;
  let discountService: DiscountService;

  beforeEach(async () => {
    const db = createDb(":memory:");
    const discountRepo = new SQLiteDiscountItemRepository(db);
    discountService = new DiscountService(discountRepo);
    const listRepo = new SQLiteShoppingListRepository(db);
    const service = new ShoppingListService(listRepo, discountService);
    handler = new ShoppingListHandler(service);

    await discountService.registerDiscountItem(
      {
        externalId: "z1",
        store: "aldi",
        name: "Zucchini",
        category: "vegetable",
        regularPrice: 199,
        salePrice: 99,
        validUntil: thisWeekValidUntil(),
        dietaryTags: ["vegan"],
        sourceUrl: null,
      },
      "job-1",
    );
  });

  test("B2: GET /list shows an empty state and the manual-add form when the list is empty", async () => {
    const html = await bodyText(await handler.handleGet(new Request("http://localhost/list")));
    expect(html).toContain(`class="empty-state"`);
    expect(html).toContain(`action="/list/add"`);
    expect(html).toContain(`name="name"`);
  });

  test("B2b: the list nav badge is absent on GET when the list is empty", async () => {
    const html = await bodyText(await handler.handleGet(new Request("http://localhost/list")));
    expect(html).not.toContain("data-nav-badge");
  });

  test("B3b: GET /list passes listCount → the nav badge renders with the item count", async () => {
    await handler.handlePostAdd(postForm("/list/add", "itemIds=aldi:z1"));
    const html = await bodyText(await handler.handleGet(new Request("http://localhost/list")));
    // The badge sits inside the /list nav anchor with the current-week count.
    const listAnchor = html.match(/<a[^>]*href="\/list"[\s\S]*?<\/a>/)?.[0] ?? "";
    expect(listAnchor).toMatch(/<span class="nav-badge" data-nav-badge>1<\/span>/);
  });

  test("B3: POST itemIds → 303 → /list, and the item then renders with total + savings", async () => {
    const addRes = await handler.handlePostAdd(postForm("/list/add", "itemIds=aldi:z1"));
    expect(addRes.status).toBe(303);
    expect(addRes.headers.get("Location")).toBe("/list");

    const html = await bodyText(await handler.handleGet(new Request("http://localhost/list")));
    expect(html).toContain("Zucchini");
    expect(html).toContain("aldi");
    expect(html).toContain("was €1.99");
    expect(html).toContain("€0.99");
    // running total (sale) + savings (regular−sale = 100c = €1.00)
    expect(html).toContain("Total €0.99");
    expect(html).toContain("You save €1.00 vs regular");
  });

  test("B4: POST name(+price) → 303 and the manual row appears", async () => {
    const addRes = await handler.handlePostAdd(postForm("/list/add", "name=Bread&price=1.49"));
    expect(addRes.status).toBe(303);

    const html = await bodyText(await handler.handleGet(new Request("http://localhost/list")));
    expect(html).toContain(`class="list-item-name">Bread`);
    expect(html).toContain("added by you");
    expect(html).toContain("€1.49");
    expect(html).toContain("Total €1.49");
  });

  test("B5: POST /list/remove → 303 and the row is gone", async () => {
    await handler.handlePostAdd(postForm("/list/add", "name=Bread&price=1.49"));
    let html = await bodyText(await handler.handleGet(new Request("http://localhost/list")));
    const idMatch = html.match(/name="id" value="([^"]+)"/);
    expect(idMatch).not.toBeNull();
    const id = idMatch![1]!;

    const removeRes = await handler.handlePostRemove(postForm("/list/remove", `id=${id}`));
    expect(removeRes.status).toBe(303);
    expect(removeRes.headers.get("Location")).toBe("/list");

    html = await bodyText(await handler.handleGet(new Request("http://localhost/list")));
    // "Bread" also appears in the manual-add placeholder ("e.g. Bread"), so assert the
    // rendered LIST is empty rather than a naive substring miss.
    expect(html).not.toContain(`class="list-item-name">Bread`);
    expect(html).toContain(`class="empty-state"`);
  });

  test("B6a: no-op add (empty body) is still a 303 with no row added", async () => {
    const res = await handler.handlePostAdd(postForm("/list/add", ""));
    expect(res.status).toBe(303);
    const html = await bodyText(await handler.handleGet(new Request("http://localhost/list")));
    expect(html).toContain(`class="empty-state"`);
  });

  test("B6b: no-op remove (no id) is still a 303", async () => {
    const res = await handler.handlePostRemove(postForm("/list/remove", ""));
    expect(res.status).toBe(303);
  });

  test("B4b: manual add with a blank name is a no-op 303", async () => {
    const res = await handler.handlePostAdd(postForm("/list/add", "name=%20%20&price=1.00"));
    expect(res.status).toBe(303);
    const html = await bodyText(await handler.handleGet(new Request("http://localhost/list")));
    expect(html).toContain(`class="empty-state"`);
  });

  // ── Async (X-Requested-With: fetch) response contract ─────────────────────
  // The overview action-hub POSTs itemIds via fetch with X-Requested-With: fetch.
  // The handler MUST answer 204 No Content (no Location) so the SPA-ish flow stays
  // on the feed, while STILL adding the item (assert via a subsequent GET /list).

  test("B7: POST itemIds WITH X-Requested-With:fetch → 204, no Location, item still added", async () => {
    const addRes = await handler.handlePostAdd(
      postForm("/list/add", "itemIds=aldi:z1", { "X-Requested-With": "fetch" }),
    );
    expect(addRes.status).toBe(204);
    expect(addRes.headers.get("Location")).toBeNull();

    const html = await bodyText(await handler.handleGet(new Request("http://localhost/list")));
    expect(html).toContain("Zucchini");
    expect(html).toContain("Total €0.99");
  });

  test("B8: POST name(+price) WITH X-Requested-With:fetch → 204, no Location, manual row appears", async () => {
    const addRes = await handler.handlePostAdd(
      postForm("/list/add", "name=Bread&price=1.49", { "X-Requested-With": "fetch" }),
    );
    expect(addRes.status).toBe(204);
    expect(addRes.headers.get("Location")).toBeNull();

    const html = await bodyText(await handler.handleGet(new Request("http://localhost/list")));
    expect(html).toContain(`class="list-item-name">Bread`);
    expect(html).toContain("added by you");
    expect(html).toContain("Total €1.49");
  });

  test("B9: POST itemIds WITHOUT the header still 303 → /list (sync baseline preserved)", async () => {
    // Contrast to B7 with the same body but no X-Requested-With header: the no-JS
    // baseline must keep the Post/Redirect/Get 303 → /list contract.
    const addRes = await handler.handlePostAdd(postForm("/list/add", "itemIds=aldi:z1"));
    expect(addRes.status).toBe(303);
    expect(addRes.headers.get("Location")).toBe("/list");
  });

  // ── Category grouping ──────────────────────────────────────────────────────

  test("B10: /list groups items under category headers in canonical order; manual → Other", async () => {
    const db = createDb(":memory:");
    const discountRepo = new SQLiteDiscountItemRepository(db);
    const ds = new DiscountService(discountRepo);
    const listRepo = new SQLiteShoppingListRepository(db);
    const svc = new ShoppingListService(listRepo, ds);
    const h = new ShoppingListHandler(svc);

    // A "Bakery" discount item and a "Produce" discount item; then a manual item ("Other").
    await ds.registerDiscountItem(
      { externalId: "b1", store: "aldi", name: "Baguette", category: "bread",
        regularPrice: 200, salePrice: 150, validUntil: thisWeekValidUntil(), dietaryTags: ["vegetarian"], sourceUrl: null },
      "job-b",
    );
    await ds.registerDiscountItem(
      { externalId: "p1", store: "aldi", name: "Apple", category: "fruit",
        regularPrice: 120, salePrice: 90, validUntil: thisWeekValidUntil(), dietaryTags: ["vegan"], sourceUrl: null },
      "job-b",
    );
    discountRepo.setCategorisation("aldi:b1", "Bakery", []);
    discountRepo.setCategorisation("aldi:p1", "Produce", []);
    await svc.addFromDiscountSelection(["aldi:b1", "aldi:p1"]);
    svc.addManualItem("Notebook", null);

    const html = await bodyText(await h.handleGet(new Request("http://localhost/list")));

    // Each present category renders a header; absent categories do not.
    expect(html).toContain(">Produce<");
    expect(html).toContain(">Bakery<");
    expect(html).toContain(">Other<");
    expect(html).not.toContain(">Drinks<");

    // Headers appear in TAXONOMY_CATEGORIES canonical order (Produce < Bakery < Other).
    const present = TAXONOMY_CATEGORIES.filter((c) => html.includes(`>${c}<`));
    const positions = present.map((c) => html.indexOf(`>${c}<`));
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
    expect(present).toEqual(["Produce", "Bakery", "Other"]);

    // Each item sits under its own category header (positional, not just present).
    expect(html.indexOf("Apple")).toBeGreaterThan(html.indexOf(">Produce<"));
    expect(html.indexOf("Baguette")).toBeGreaterThan(html.indexOf(">Bakery<"));
    expect(html.indexOf("Notebook")).toBeGreaterThan(html.indexOf(">Other<"));

    // Totals unchanged: sum sale = 150+90 = 240 = €2.40; savings = 50+30 = 80 = €0.80.
    expect(html).toContain("Total €2.40");
    expect(html).toContain("You save €0.80 vs regular");
  });
});
