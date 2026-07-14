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

import type { SavingsService } from "../savings-service.ts";

function formatEuros(cents: number): string {
  return `€${(cents / 100).toFixed(2)}`;
}

export class SavingsHandler {
  constructor(private readonly savingsService: SavingsService) {}

  async handleGet(request: Request): Promise<Response> {
    const records = await this.savingsService.getHistory();

    const rows = records
      .map(
        (record) => `
      <tr>
        <td>${record.weekStart}</td>
        <td><span data-saved-amount="${record.savedAmount}">${formatEuros(record.savedAmount)}</span></td>
        <td>${record.itemCount}</td>
      </tr>`,
      )
      .join("");

    const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>Savings Tracker</title></head>
<body>
  <h1>Weekly Savings</h1>
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
