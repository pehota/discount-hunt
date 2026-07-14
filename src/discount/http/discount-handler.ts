/**
 * DiscountHandler — primary HTTP adapter for GET /
 *
 * Reads filtered discount items via DiscountService.
 * Passes dietary_filter from UserPreferencesRepository into getByWeek query.
 * Renders server-side HTML: item list with regular_price ("was €X.XX") and sale_price.
 * Shows "No discounts available this week" when item list is empty.
 *
 * Also renders staleness warning if scrape_jobs.last_successful_run > 48h ago.
 */

export const __SCAFFOLD__ = true as const;

export class DiscountHandler {
  constructor(
    private readonly discountService: unknown,
    private readonly preferencesRepository: unknown,
  ) {}

  async handleGet(request: Request): Promise<Response> {
    throw new Error("Not yet implemented — RED scaffold");
  }
}
