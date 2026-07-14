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

    const itemsHtml = knownStores.length === 0
      ? this.renderFallback(items)
      : this.renderWithStoreContext(items, knownStores);

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Discount Hunt — Weekly Deals</title>
</head>
<body>
  <header>
    <h1>Weekly Discount Feed</h1>
  </header>
  <main>
    <section id="discount-items">
      ${itemsHtml}
    </section>
    <section id="meal-plan-action">
      <form method="POST" action="/plan/generate">
        <button type="submit" id="generate-meal-plan">Generate Meal Plan</button>
      </form>
    </section>
  </main>
</body>
</html>`;

    return new Response(html, {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }

  private renderFallback(items: Awaited<ReturnType<DiscountService["getWeeklyItems"]>>): string {
    if (items.length === 0) {
      return `<p class="empty-state">No discounts available this week</p>`;
    }
    return this.renderItemsByStore(items);
  }

  private renderWithStoreContext(
    items: Awaited<ReturnType<DiscountService["getWeeklyItems"]>>,
    knownStores: string[],
  ): string {
    const now = Date.now();
    const storeItems = this.groupItemsByStore(items);
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
          `<div class="staleness-warning">Data for ${store} may be outdated — last refreshed ${lastRefreshed}</div>`,
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
        sections.push(
          `<section class="store-group">
      <h2 class="store-name">${store}</h2>
      <p class="empty-state">No discounts this week at ${store}</p>
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
      .map(
        (item) => `
      <article class="discount-item">
        <h3 class="item-name">${item.name}</h3>
        <p class="item-price">
          <span class="was-price">was €${centsToEuros(item.regularPrice)}</span>
          <span class="sale-price">€${centsToEuros(item.salePrice)}</span>
        </p>
      </article>`,
      )
      .join("\n");
    return `<section class="store-group">
      <h2 class="store-name">${storeName}</h2>
      ${storeItemsHtml}
    </section>`;
  }
}
