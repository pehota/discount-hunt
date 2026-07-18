/**
 * recipe-cache-warmer — RED scaffold (created by DISTILL, meal-plan-engine ADR-006 Option D).
 *
 * Cron one-shot post-Monday-scrape (same shape as scrape.ts): a bounded paced crawl
 * (1 req / 30-35 s, 429 backoff, health.warmer.refused on push-back) of queries derived from
 * THIS WEEK's live deals into the shipped 7-day `recipes` cache. Generation reads cache-first ->
 * sub-second regenerate; a cold-cache miss falls back to live-throttled fetch at generation time.
 *
 * Driving/subprocess adapter (like the scraper) — invoked via `bun run src/recipe/recipe-cache-warmer.ts`.
 */

export const __SCAFFOLD__ = true;

export interface WarmerResult {
  readonly warmedQueries: number;
  readonly refused: boolean;
}

/** Warm the recipe cache for this week's deals. Returns a summary; never throws on 429 (backs off). */
export async function warmRecipeCache(dbPath: string): Promise<WarmerResult> {
  throw new Error("Not yet implemented — RED scaffold");
}
