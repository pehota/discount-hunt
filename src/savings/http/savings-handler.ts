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
import type { SavingsRecord } from "../adapters/sqlite-savings-repository.ts";
import type { SavingsService, SavingsSummary } from "../savings-service.ts";

function formatEuros(cents: number): string {
  return `€${(cents / 100).toFixed(2)}`;
}

function isSavingsUnavailable(record: SavingsRecord): boolean {
  return record.totalRegularPrice === 0;
}

function renderThisWeekBreakdown(thisWeek: SavingsRecord | null): string {
  if (thisWeek === null) {
    return `<section class="this-week"><p>No plan generated for this week yet.</p></section>`;
  }
  return `<section class="this-week">
    <h2>This Week</h2>
    <p>Paid: <span data-week-paid="${thisWeek.totalSalePrice}">${formatEuros(thisWeek.totalSalePrice)}</span></p>
    <p>Would have paid: <span data-week-would-have-paid="${thisWeek.totalRegularPrice}">${formatEuros(thisWeek.totalRegularPrice)}</span></p>
    <p>Saved: <span data-week-saved="${thisWeek.savedAmount}">${formatEuros(thisWeek.savedAmount)}</span></p>
  </section>`;
}

function renderSavedCell(record: SavingsRecord): string {
  if (isSavingsUnavailable(record)) {
    return `<td>Savings unavailable</td>`;
  }
  return `<td><span data-saved-amount="${record.savedAmount}">${formatEuros(record.savedAmount)}</span></td>`;
}

function renderHistoryRow(record: SavingsRecord): string {
  return `
      <tr>
        <td>${escapeHtml(record.weekStart)}</td>
        ${renderSavedCell(record)}
        <td>${record.itemCount}</td>
      </tr>`;
}

export class SavingsHandler {
  constructor(private readonly savingsService: SavingsService) {}

  async handleGet(request: Request): Promise<Response> {
    const summary: SavingsSummary = await this.savingsService.getSummary();

    const rows = summary.history.map(renderHistoryRow).join("");

    const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>Savings Tracker</title></head>
<body>
  <h1>Weekly Savings</h1>
  ${renderThisWeekBreakdown(summary.thisWeek)}
  <section class="month-to-date">
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
  </table>
</body>
</html>`;

    return new Response(html, {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }
}
