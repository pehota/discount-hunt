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

export const __SCAFFOLD__ = true as const;

export class SavingsHandler {
  constructor(private readonly savingsService: unknown) {}

  async handleGet(request: Request): Promise<Response> {
    throw new Error("Not yet implemented — RED scaffold");
  }
}
