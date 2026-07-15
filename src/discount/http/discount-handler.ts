/**
 * DiscountHandler — primary HTTP adapter for GET /
 *
 * Thin driving adapter: reads weekly discount items via DiscountService,
 * renders server-side HTML with item names, regular price ("was"), and sale price.
 *
 * When scrapeJobRepo is provided:
 *   - Shows staleness-warning for stores whose last completed run is > 48h ago
 *   - Shows per-store empty-state ("No discounts this week at {store}") for stores with 0 items
 *   - Falls back to global empty-state only when no scrape jobs exist at all
 *
 * When scrapeJobRepo is absent (legacy / unit-test path):
 *   - Falls back to prior behavior: global empty-state if no items
 *
 * No business logic here — filtering (D21) happens upstream in the service/repo layer.
 */

import type { DiscountService } from "../discount-service.ts";
import type { SQLiteScrapeJobRepository } from "../../scraping/adapters/sqlite-scrape-job-repository.ts";
import type { UserPreferencesRepository } from "../../preferences/ports/preferences-repository.ts";
import { currentWeekMonday } from "../../shared/week.ts";
import { escapeHtml } from "../../shared/html.ts";
import { renderPage } from "../../shared/layout.ts";

/**
 * Inline client-side filter (zero deps; htmx is not loaded on this page).
 * Progressive enhancement: on click, set the active pill, show only matching
 * `.store-group[data-store]` sections (All = show all), and update the status line.
 * Without JS this never runs, so all sections remain visible (graceful fallback).
 * Written as a plain string constant to avoid backtick/${} collisions with the
 * surrounding TS template literals. The "All" pill uses the sentinel "__all__".
 */
const FILTER_SCRIPT = `
(function () {
  var bar = document.querySelector('.filter-bar');
  if (!bar) return;
  var pills = bar.querySelectorAll('.filter-pill');
  var status = bar.querySelector('.filter-status');
  bar.addEventListener('click', function (e) {
    var pill = e.target.closest('.filter-pill');
    if (!pill) return;
    var filter = pill.getAttribute('data-filter');
    for (var i = 0; i < pills.length; i++) {
      var active = pills[i] === pill;
      pills[i].classList.toggle('active', active);
      pills[i].setAttribute('aria-pressed', active ? 'true' : 'false');
      if (active) { pills[i].setAttribute('aria-current', 'true'); }
      else { pills[i].removeAttribute('aria-current'); }
    }
    // Query sections at click time: this inline script parses BEFORE #discount-items,
    // so a load-time query would see an empty NodeList. By click time they exist.
    var groups = document.querySelectorAll('#discount-items .store-group[data-store]');
    for (var j = 0; j < groups.length; j++) {
      var match = filter === '__all__' || groups[j].getAttribute('data-store') === filter;
      groups[j].hidden = !match;
    }
    var label = pill.getAttribute('data-filter') === '__all__' ? 'All' : filter;
    var count = pill.querySelector('.pill-count');
    var n = count ? count.textContent : '';
    if (status) { status.textContent = 'Showing: ' + label + ' (' + n + ')'; }
  });
})();
`;

const STALENESS_THRESHOLD_HOURS = 48;
const STALENESS_THRESHOLD_MS = STALENESS_THRESHOLD_HOURS * 60 * 60 * 1000;
const DATE_LOCALE = "de-DE";

/** Staleness predicate: returns true if the last run was more than 48 hours ago. */
export function isStale(completedAt: number, now: number): boolean {
  return now - completedAt > STALENESS_THRESHOLD_MS;
}

function centsToEuros(cents: number): string {
  return (cents / 100).toFixed(2);
}

/** Whole-number discount percentage (regular vs sale). Guards a zero/absent regular price. */
function discountPercent(regularPrice: number, salePrice: number): number {
  if (regularPrice <= 0 || salePrice >= regularPrice) return 0;
  return Math.round(((regularPrice - salePrice) / regularPrice) * 100);
}

export class DiscountHandler {
  constructor(
    private readonly discountService: DiscountService,
    private readonly scrapeJobRepo?: SQLiteScrapeJobRepository,
    private readonly preferencesRepo?: UserPreferencesRepository,
  ) {}

  async handleGet(_request: Request): Promise<Response> {
    const weekStart = currentWeekMonday();
    // LIVE read on every request — the feed re-filters the moment the setting changes.
    const restriction = this.preferencesRepo?.get().dietaryRestriction ?? "none";
    const items = await this.discountService.getWeeklyItems(weekStart, restriction);
    const knownStores = this.scrapeJobRepo?.getStoresWithJobs() ?? [];

    // Single source of truth: group items ONCE, then derive BOTH the filter pills
    // and the rendered sections from the same grouping (no divergent recount).
    const storeItems = this.groupItemsByStore(items);

    const itemsHtml = knownStores.length === 0
      ? this.renderFallback(items)
      : this.renderWithStoreContext(items, knownStores, storeItems);

    const filterBar = this.renderFilterBar(items.length, storeItems);

    const body = `<header>
    <h1>Weekly Discount Feed</h1>
  </header>
  ${filterBar}
  <form class="selection-form" method="POST" action="/plan/generate">
    <section id="discount-items">
      ${itemsHtml}
    </section>
    <section id="meal-plan-action">
      <button type="submit" id="generate-meal-plan">Generate Meal Plan</button>
    </section>
  </form>`;

    const html = renderPage({
      title: "Discount Hunt — Weekly Deals",
      activeNav: "feed",
      body,
    });

    return new Response(html, {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }

  private renderFallback(items: Awaited<ReturnType<DiscountService["getWeeklyItems"]>>): string {
    if (items.length === 0) {
      return `<p class="empty-state"><span class="state-illustration" aria-hidden="true">🛒</span>No discounts available this week</p>`;
    }
    return this.renderItemsByStore(items);
  }

  /**
   * Filter bar (progressive enhancement): an "All" pill with the TOTAL count plus one
   * pill per store that has ≥1 item, each with that store's count — derived from the SAME
   * grouping the sections use. Pills are <button>s (keyboard-accessible, ≥44px via CSS).
   * Default active = All. Without JS, all sections stay visible and the bar is inert (the
   * inline script below is the only thing that hides sections).
   */
  private renderFilterBar(
    total: number,
    storeItems: Map<string, Awaited<ReturnType<DiscountService["getWeeklyItems"]>>>,
  ): string {
    const allPill =
      `<button type="button" class="filter-pill active" data-filter="__all__" aria-pressed="true" aria-current="true">All <span class="pill-count">${total}</span></button>`;
    const storePills = Array.from(storeItems.entries())
      .filter(([, group]) => group.length > 0)
      .map(([store, group]) => {
        const safeStore = escapeHtml(store);
        return `<button type="button" class="filter-pill" data-filter="${safeStore}" aria-pressed="false">${safeStore} <span class="pill-count">${group.length}</span></button>`;
      })
      .join("\n      ");

    return `<nav class="filter-bar" aria-label="Filter deals by store">
    <div class="filter-pills" role="group">
      ${allPill}
      ${storePills}
    </div>
    <p class="filter-status" aria-live="polite">Showing: All (${total})</p>
  </nav>
  <script>${FILTER_SCRIPT}</script>`;
  }

  private renderWithStoreContext(
    items: Awaited<ReturnType<DiscountService["getWeeklyItems"]>>,
    knownStores: string[],
    storeItems: Map<string, Awaited<ReturnType<DiscountService["getWeeklyItems"]>>>,
  ): string {
    const now = Date.now();
    const warnings = this.buildStalenessWarnings(knownStores, now);
    const sections = this.buildStoreSections(knownStores, storeItems);

    // Render items for stores not in knownStores (edge case: items from unknown stores)
    for (const [store, group] of storeItems.entries()) {
      if (!knownStores.includes(store)) {
        sections.push(this.renderStoreSection(store, group));
      }
    }

    return [...warnings, ...sections].join("\n");
  }

  private groupItemsByStore(
    items: Awaited<ReturnType<DiscountService["getWeeklyItems"]>>,
  ): Map<string, Awaited<ReturnType<DiscountService["getWeeklyItems"]>>> {
    const storeItems = new Map<string, typeof items>();
    for (const item of items) {
      const group = storeItems.get(item.store) ?? [];
      group.push(item);
      storeItems.set(item.store, group);
    }
    return storeItems;
  }

  private buildStalenessWarnings(knownStores: string[], now: number): string[] {
    const warnings: string[] = [];
    for (const store of knownStores) {
      const completedAt = this.scrapeJobRepo!.getLastSuccessfulRunByStore(store);
      if (completedAt !== null && isStale(completedAt, now)) {
        const lastRefreshed = new Date(completedAt).toLocaleDateString(DATE_LOCALE);
        warnings.push(
          `<div class="staleness-warning">Data for ${escapeHtml(store)} may be outdated — last refreshed ${lastRefreshed}</div>`,
        );
      }
    }
    return warnings;
  }

  private buildStoreSections(
    knownStores: string[],
    storeItems: Map<string, Awaited<ReturnType<DiscountService["getWeeklyItems"]>>>,
  ): string[] {
    const sections: string[] = [];
    for (const store of knownStores) {
      const storeGroup = storeItems.get(store) ?? [];
      if (storeGroup.length === 0) {
        const safeStore = escapeHtml(store);
        sections.push(
          `<section class="store-group" data-store="${safeStore}">
      <h2 class="store-name">${safeStore}</h2>
      <p class="empty-state">No discounts this week at ${safeStore}</p>
    </section>`,
        );
      } else {
        sections.push(this.renderStoreSection(store, storeGroup));
      }
    }
    return sections;
  }

  private renderItemsByStore(items: Awaited<ReturnType<DiscountService["getWeeklyItems"]>>): string {
    const byStore = new Map<string, typeof items>();
    for (const item of items) {
      const group = byStore.get(item.store) ?? [];
      group.push(item);
      byStore.set(item.store, group);
    }
    return Array.from(byStore.entries())
      .map(([storeName, storeItems]) => this.renderStoreSection(storeName, storeItems))
      .join("\n");
  }

  private renderStoreSection(
    storeName: string,
    storeItems: Awaited<ReturnType<DiscountService["getWeeklyItems"]>>,
  ): string {
    const storeItemsHtml = storeItems
      .map((item) => {
        const pct = discountPercent(item.regularPrice, item.salePrice);
        const badge = pct > 0
          ? `<span class="savings-badge" aria-label="save ${pct} percent">−${pct}%</span>`
          : "";
        // Selection checkbox — checked by default so Generate uses ALL items unless the
        // user deselects. The <label> (associated via for/id) toggles it; a ≥44px tap
        // target comes from CSS. The checkbox is independent of the filter: the filter JS
        // only sets .hidden on sections, so a hidden card's checkbox STILL submits.
        const inputId = `select-${escapeHtml(item.id)}`;
        const selection = `<label class="card-select" for="${inputId}">
          <input type="checkbox" id="${inputId}" name="itemIds" value="${escapeHtml(item.id)}" checked>
          <span class="card-select-text">Include</span>
        </label>`;
        return `
      <div class="card" data-item-card>
        ${badge}
        ${selection}
        <article class="discount-item">
        <h3 class="item-name">${escapeHtml(item.name)}</h3>
        <p class="item-price">
          <span class="was-price">was €${centsToEuros(item.regularPrice)}</span>
          <span class="sale-price">€${centsToEuros(item.salePrice)}</span>
        </p>
      </article>
      </div>`;
      })
      .join("\n");
    return `<section class="store-group" data-store="${escapeHtml(storeName)}">
      <h2 class="store-name">${escapeHtml(storeName)}</h2>
      <div class="card-grid">
      ${storeItemsHtml}
      </div>
    </section>`;
  }
}
