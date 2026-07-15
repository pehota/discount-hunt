/**
 * SQLiteRecipeRepository — secondary adapter implementing the RecipeRepository port.
 *
 * Table: recipes (see src/shared/schema.ts)
 * Commands: getByQuery, cache, markSourceDead
 *
 * Invariants:
 *   - cached_content IS NOT NULL on every cache (recipe without cached content not persisted)
 *   - cached_at is the canonical freshness indicator (TTL = 7 days, checked by RecipeService)
 *   - source_url_valid reflects the last reachability verdict
 *   - markSourceDead changes ONLY source_url_valid — cached_content is preserved
 *
 * query_key = meal.name.toLowerCase().trim(). UNIQUE(query_key) gives
 * INSERT-OR-REPLACE cache semantics (one row per query, structurally).
 */

import { eq, sql } from "drizzle-orm";
import type { DbClient } from "../../shared/db.ts";
import { recipes } from "../../shared/schema.ts";

/** Row shape of a cached recipe — ingredients/steps parsed from cached_content JSON. */
export interface CachedRecipe {
  id: string;
  queryKey: string;
  name: string;
  ingredients: string[];
  steps: string[];
  sourceUrl: string;
  sourceUrlValid: boolean;
  cachedAt: number;
}

export class SQLiteRecipeRepository {
  constructor(private readonly db: DbClient) {}

  getByQuery(queryKey: string): CachedRecipe | null {
    const row = this.db.select().from(recipes)
      .where(eq(recipes.queryKey, queryKey))
      .get();
    if (!row) {
      return null;
    }
    return this.toCachedRecipe(row);
  }

  cache(recipe: CachedRecipe): void {
    const content = JSON.stringify({ ingredients: recipe.ingredients, steps: recipe.steps });
    // INSERT OR REPLACE by query_key — UNIQUE constraint makes the upsert single-row.
    this.db.run(sql`
      INSERT INTO recipes
        (id, query_key, name, cached_content, source_url, source_url_valid, cached_at)
      VALUES
        (${recipe.id}, ${recipe.queryKey}, ${recipe.name}, ${content},
         ${recipe.sourceUrl}, ${recipe.sourceUrlValid ? 1 : 0}, ${recipe.cachedAt})
      ON CONFLICT(query_key) DO UPDATE SET
        id = excluded.id,
        name = excluded.name,
        cached_content = excluded.cached_content,
        source_url = excluded.source_url,
        source_url_valid = excluded.source_url_valid,
        cached_at = excluded.cached_at
    `);
  }

  markSourceDead(recipeId: string): void {
    // Touches ONLY source_url_valid — cached_content and every other column preserved.
    this.db.update(recipes)
      .set({ sourceUrlValid: 0 })
      .where(eq(recipes.id, recipeId))
      .run();
  }

  private toCachedRecipe(row: typeof recipes.$inferSelect): CachedRecipe {
    const content = JSON.parse(row.cachedContent) as { ingredients: string[]; steps: string[] };
    return {
      id: row.id,
      queryKey: row.queryKey,
      name: row.name,
      ingredients: content.ingredients,
      steps: content.steps,
      sourceUrl: row.sourceUrl,
      sourceUrlValid: row.sourceUrlValid === 1,
      cachedAt: row.cachedAt,
    };
  }
}
