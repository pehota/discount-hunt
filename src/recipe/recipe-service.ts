/**
 * RecipeService — domain service for the Recipe Matching bounded context.
 *
 * S01: stub — returns a hardcoded recipe URL for plan generation (OQ-1 deferred to S05).
 * S05: real Brave Search + Chefkoch JSON-LD integration.
 *
 * Use cases:
 *   GetRecipe(ingredientName): cache-first lookup (7-day TTL); triggers CacheRecipe on miss
 *   CacheRecipe(ingredientName, ...): fetch via Brave → Chefkoch → insert with cached_content
 *   RefreshRecipe(recipeId): re-fetch after TTL expiry
 *   MarkSourceDead(recipeId): set source_url_valid=false; cached_content remains
 */

export const __SCAFFOLD__ = true as const;

export class RecipeService {
  constructor(
    private readonly recipeRepository: unknown,
    private readonly recipeSearchClient: unknown,
    private readonly recipeFetcher: unknown,
  ) {}

  async getRecipe(ingredientName: string): Promise<unknown | null> {
    throw new Error("Not yet implemented — RED scaffold");
  }

  async cacheRecipe(ingredientName: string): Promise<unknown> {
    throw new Error("Not yet implemented — RED scaffold");
  }

  async refreshRecipe(recipeId: string): Promise<void> {
    throw new Error("Not yet implemented — RED scaffold");
  }

  async markSourceDead(recipeId: string): Promise<void> {
    throw new Error("Not yet implemented — RED scaffold");
  }
}
