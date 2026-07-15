/**
 * ShoppingListHandler — primary HTTP adapter for the shopping list.
 *
 * Routes:
 *   GET  /list         — renders the current-week list, running total, total savings,
 *                        a per-item remove control, and a manual-add form
 *   POST /list/add      — adds from a discount selection (itemIds) OR a manual entry
 *                         (name + optional price); always 303 → /list
 *   POST /list/remove   — removes one row by id; always 303 → /list
 *
 * Thin driving adapter: no business logic, delegates to ShoppingListService.
 * Both POSTs (and no-op inputs) 303-redirect so a browser refresh re-GETs the list
 * (Post/Redirect/Get). Scraped snapshots (name, store) are untrusted → escaped.
 */

import { escapeHtml } from "../../shared/html.ts";
import { renderPage } from "../../shared/layout.ts";
import type { ShoppingListItem } from "../ports/shopping-list-repository.ts";
import type {
  ShoppingListService,
  ShoppingListSummary,
} from "../shopping-list-service.ts";

function centsToEuros(cents: number): string {
  return (cents / 100).toFixed(2);
}

/**
 * Parses an untrusted euros price field into cents, mirroring settings-handler's
 * parseBudgetCapCents discipline: blank/non-finite/negative → null (no price).
 * Guards the Number("") === 0 trap by rejecting blank before the numeric parse.
 */
function parsePriceCents(raw: string | null): number | null {
  if (raw === null) return null;
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  const euros = Number(trimmed);
  if (!Number.isFinite(euros) || euros < 0) return null;
  return Math.round(euros * 100);
}

function redirectToList(): Response {
  return new Response(null, { status: 303, headers: { Location: "/list" } });
}

/**
 * Add-result response: a bodyless 204 (no Location) for async fetch callers so the
 * page stays put, else the Post/Redirect/Get 303 → /list. One helper routes all
 * three exit paths of handlePostAdd — the branch logic never duplicates it.
 */
function respond(wantsAsync: boolean): Response {
  if (wantsAsync) return new Response(null, { status: 204 });
  return redirectToList();
}

/** Renders the source line: the escaped store, or the literal "added by you" for manual rows. */
function renderSource(item: ShoppingListItem): string {
  if (item.source === "manual") return `<span class="list-item-source">added by you</span>`;
  const store = item.store === null ? "" : escapeHtml(item.store);
  return `<span class="list-item-source">${store}</span>`;
}

/** Renders the price line: an optional strike-through "was" then the sale price (nothing if null). */
function renderPrice(item: ShoppingListItem): string {
  if (item.salePriceCents === null) return "";
  const was = item.regularPriceCents !== null
    ? `<span class="was-price">was €${centsToEuros(item.regularPriceCents)}</span>`
    : "";
  return `${was}<span class="sale-price">€${centsToEuros(item.salePriceCents)}</span>`;
}

function renderItem(item: ShoppingListItem): string {
  return `
      <li class="list-item">
        <span class="list-item-name">${escapeHtml(item.name)}</span>
        ${renderSource(item)}
        <span class="list-item-price">${renderPrice(item)}</span>
        <form method="POST" action="/list/remove">
          <input type="hidden" name="id" value="${escapeHtml(item.id)}">
          <button type="submit">Remove</button>
        </form>
      </li>`;
}

function renderList(summary: ShoppingListSummary): string {
  if (summary.items.length === 0) {
    return `<p class="empty-state"><span class="state-illustration" aria-hidden="true">🧾</span>Your shopping list is empty</p>`;
  }
  const rows = summary.items.map(renderItem).join("\n");
  return `<ul class="shopping-list">
      ${rows}
    </ul>
    <p class="list-total">Total €${centsToEuros(summary.totalCents)}</p>
    <p class="list-savings">You save €${centsToEuros(summary.savingsCents)} vs regular</p>`;
}

function renderManualAddForm(): string {
  return `<form method="POST" action="/list/add" class="manual-add-form">
    <label for="list-add-name">Item</label>
    <input type="text" name="name" id="list-add-name" placeholder="e.g. Bread">
    <label for="list-add-price">Price (€)</label>
    <input type="number" name="price" id="list-add-price" min="0" step="0.01">
    <button type="submit">Add</button>
  </form>`;
}

export class ShoppingListHandler {
  constructor(private readonly service: ShoppingListService) {}

  handleGet(_request: Request): Response {
    const summary = this.service.getCurrentList();
    const body = `<h1>Shopping List</h1>
  ${renderList(summary)}
  ${renderManualAddForm()}`;
    const html = renderPage({
      title: "Shopping List",
      activeNav: "list",
      body,
      listCount: summary.items.length,
    });
    return new Response(html, {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }

  async handlePostAdd(request: Request): Promise<Response> {
    // Async callers (the feed action-hub fetch) send X-Requested-With: fetch and
    // want a bodyless 204 so the page stays put; the no-JS baseline gets a 303 → /list.
    const wantsAsync = request.headers.get("X-Requested-With") === "fetch";
    const form = new URLSearchParams(await request.text());
    const ids = form.getAll("itemIds").filter((id) => id.trim() !== "");
    if (ids.length > 0) {
      await this.service.addFromDiscountSelection(ids);
      return respond(wantsAsync);
    }
    const name = form.get("name");
    if (name !== null && name.trim() !== "") {
      this.service.addManualItem(name.trim(), parsePriceCents(form.get("price")));
    }
    return respond(wantsAsync);
  }

  async handlePostRemove(request: Request): Promise<Response> {
    const form = new URLSearchParams(await request.text());
    const id = form.get("id");
    if (id !== null && id.trim() !== "") {
      this.service.remove(id);
    }
    return redirectToList();
  }
}
