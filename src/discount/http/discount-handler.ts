/**
 * DiscountHandler — primary HTTP adapter for GET /
 *
 * Thin driving adapter: reads weekly discount items via DiscountService,
 * renders server-side HTML with item names, regular price ("was"), and sale price.
 * Shows "No discounts available this week" when item list is empty.
 * Generate Meal Plan button is always visible (US-01 AC).
 *
 * No business logic here — filtering (D21) happens upstream in the service/repo layer.
 */

import type { DiscountService } from "../discount-service.ts";

function centsToEuros(cents: number): string {
  return (cents / 100).toFixed(2);
}

function getCurrentWeekStart(): string {
  const now = new Date();
  const dayOfWeek = now.getUTCDay(); // 0=Sun, 1=Mon, ..., 6=Sat
  const daysToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  const monday = new Date(now);
  monday.setUTCDate(now.getUTCDate() + daysToMonday);
  return monday.toISOString().slice(0, 10);
}

export class DiscountHandler {
  constructor(private readonly discountService: DiscountService) {}

  async handleGet(_request: Request): Promise<Response> {
    const weekStart = getCurrentWeekStart();
    const items = await this.discountService.getWeeklyItems(weekStart, "none");

    const itemsHtml =
      items.length === 0
        ? `<p class="empty-state">No discounts available this week</p>`
        : items
            .map(
              (item) => `
      <article class="discount-item">
        <h2 class="item-name">${item.name}</h2>
        <p class="item-store">${item.store}</p>
        <p class="item-price">
          <span class="was-price">was €${centsToEuros(item.regularPrice)}</span>
          <span class="sale-price">€${centsToEuros(item.salePrice)}</span>
        </p>
      </article>`
            )
            .join("\n");

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
      <button type="button" id="generate-meal-plan">Generate Meal Plan</button>
    </section>
  </main>
</body>
</html>`;

    return new Response(html, {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }
}
