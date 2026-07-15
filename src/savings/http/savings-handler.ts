/**
 * SavingsHandler — primary HTTP adapter for GET /savings
 *
 * Renders weekly savings history and month-to-date total.
 * saved_amount must equal estimated_savings from the linked MealPlan (D23).
 * Prior-week records are immutable — no edit controls rendered (D24).
 *
 * AT CONTRACT: handleGet must render saved_amount for each week as:
 *   <span data-saved-amount="{cents}">€{euros}</span>  (cents = integer, e.g. 290 for €2.90)
 *   The walking-skeleton AT extracts data-saved-amount to assert D23 structurally.
 */

import { escapeHtml } from "../../shared/html.ts";
import { renderPage } from "../../shared/layout.ts";
import type { SavingsRecord } from "../adapters/sqlite-savings-repository.ts";
import { isSavingsUnavailable, type SavingsService, type SavingsSummary } from "../savings-service.ts";

function formatEuros(cents: number): string {
  return `€${(cents / 100).toFixed(2)}`;
}

function renderThisWeekBreakdown(thisWeek: SavingsRecord | null): string {
  if (thisWeek === null) {
    return `<section class="this-week secondary-stat"><p>No plan generated for this week yet.</p></section>`;
  }
  if (isSavingsUnavailable(thisWeek)) {
    return `<section class="this-week secondary-stat">
    <h2>This Week</h2>
    <p>Savings unavailable</p>
  </section>`;
  }
  const pct = thisWeek.totalRegularPrice > 0
    ? Math.round((thisWeek.savedAmount / thisWeek.totalRegularPrice) * 100)
    : 0;
  const pctChip = pct > 0 ? `<span class="hero-pct">−${pct}%</span>` : "";
  // The saved figure is the emotional core — rendered as the hero. The exact
  // data-week-* spans are preserved verbatim (D23 / savings-history AT contract).
  return `<section class="this-week savings-hero">
    <p class="hero-label">Saved this week</p>
    <span class="hero-amount" data-week-saved="${thisWeek.savedAmount}">${formatEuros(thisWeek.savedAmount)}</span>
    <p class="hero-sub">paid <span data-week-paid="${thisWeek.totalSalePrice}">${formatEuros(thisWeek.totalSalePrice)}</span> · would've paid <span data-week-would-have-paid="${thisWeek.totalRegularPrice}">${formatEuros(thisWeek.totalRegularPrice)}</span></p>
    ${pctChip}
  </section>`;
}

function renderSavedCell(record: SavingsRecord): string {
  if (isSavingsUnavailable(record)) {
    return `<td data-label="Saved">Savings unavailable</td>`;
  }
  return `<td data-label="Saved"><span data-saved-amount="${record.savedAmount}">${formatEuros(record.savedAmount)}</span></td>`;
}

function renderHistoryRow(record: SavingsRecord): string {
  return `
      <tr>
        <td data-label="Week">${escapeHtml(record.weekStart)}</td>
        ${renderSavedCell(record)}
        <td data-label="Items">${record.itemCount}</td>
      </tr>`;
}

export class SavingsHandler {
  constructor(private readonly savingsService: SavingsService) {}

  async handleGet(request: Request): Promise<Response> {
    const summary: SavingsSummary = await this.savingsService.getSummary();

    const rows = summary.history.map(renderHistoryRow).join("");

    const body = `<h1>Weekly Savings</h1>
  ${renderThisWeekBreakdown(summary.thisWeek)}
  <section class="month-to-date secondary-stat">
    <h2>Month to date</h2>
    <p>Saved so far: <span data-month-to-date="${summary.monthToDateCents}">${formatEuros(summary.monthToDateCents)}</span></p>
  </section>
  <table>
    <thead>
      <tr><th>Week</th><th>Saved</th><th>Items</th></tr>
    </thead>
    <tbody>
      ${rows}
    </tbody>
  </table>`;

    const html = renderPage({ title: "Savings Tracker", activeNav: "savings", body });

    return new Response(html, {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }
}
