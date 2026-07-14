/**
 * CatalogueProbe — substrate honesty probe for the Aldi Süd catalogue.
 *
 * Run per scraper invocation (before fetching pages):
 *   1. Validate 302 Location header matches kw{N}-{yy}-op-mp slug pattern
 *   2. Validate first parsed item has at least title + price fields
 *   3. Warn if both-price coverage drops below 10% (slug drift signal)
 *
 * On failure: log health.scrape.refused; retain stale data; emit staleness warning.
 * Does NOT throw — returns ProbeResult for caller to decide.
 */

export const __SCAFFOLD__ = true as const;

export interface ProbeResult {
  passed: boolean;
  slugValid: boolean;
  itemShapeValid: boolean;
  bothPriceCoveragePercent: number | null;
  warnings: string[];
}

export class CatalogueProbe {
  async run(): Promise<ProbeResult> {
    throw new Error("Not yet implemented — RED scaffold");
  }
}
