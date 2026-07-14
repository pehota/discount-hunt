/**
 * SQLiteRecipeRepository — secondary adapter implementing RecipeRepository port.
 *
 * Table: recipes (see src/shared/schema.ts)
 * Commands: getByIngredient, cache, refresh, markDead
 *
 * Invariants:
 *   - cached_content IS NOT NULL at creation (recipe without cached content not persisted)
 *   - cached_at is the canonical freshness indicator (TTL = 7 days)
 *   - source_url_valid reflects last reachability check
 */

export const __SCAFFOLD__ = true as const;

export class SQLiteRecipeRepository {
  constructor(private readonly db: unknown) {}

  async getByIngredient(ingredientName: string): Promise<unknown | null> {
    throw new Error("Not yet implemented — RED scaffold");
  }

  async cache(recipe: unknown): Promise<void> {
    throw new Error("Not yet implemented — RED scaffold");
  }

  async refresh(recipeId: string, data: unknown): Promise<void> {
    throw new Error("Not yet implemented — RED scaffold");
  }

  async markDead(recipeId: string): Promise<void> {
    throw new Error("Not yet implemented — RED scaffold");
  }
}
