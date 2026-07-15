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

function thisWeekValidUntil(): string {
  const monday = new Date(`${currentWeekMonday()}T00:00:00.000Z`);
  monday.setUTCDate(monday.getUTCDate() + 6);
  return monday.toISOString().slice(0, 10);
}

function postForm(path: string, body: string): Request {
  return new Request(`http://localhost${path}`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
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
});
