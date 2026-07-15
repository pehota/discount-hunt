/**
 * RecipeService — domain service for the Recipe Matching bounded context (design §6).
 *
 * Cache-first with a 7-day TTL keyed on cached_at. The refresh-on-expiry path is the
 * ONLY place the source is re-validated (design §6):
 *   - fresh cache  → returned as-is, NO network, trust the stored source_url_valid
 *   - miss/expired → RecipeSource.find (network in PROD, deterministic in TESTS):
 *       - found        → cache with source_url_valid=true, cached_at=now; return fresh
 *       - null + stale → markSourceDead, return the stale copy w/ sourceUrlValid=false
 *       - null + empty → return null
 *
 * Contract shape: bounded-change — mutates at most one recipes row for queryKey(mealName).
 */

import { randomUUID } from "node:crypto";
import type { SQLiteRecipeRepository, CachedRecipe } from "./adapters/sqlite-recipe-repository.ts";
import type { RecipeSource } from "./ports/recipe-source.ts";
import { buildRecipeQuery, type RecipeQueryPreferences } from "./recipe-query.ts";
import type { MealSlot } from "../shared/types.ts";

const TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Recipe resolved for the view — same surface as a cached row. */
export type ResolvedRecipe = CachedRecipe;

export class RecipeService {
  constructor(
    private readonly recipeRepository: SQLiteRecipeRepository,
    private readonly recipeSource: RecipeSource,
  ) {}

  async getRecipeForMeal(
    mealName: string,
    mealType?: MealSlot,
    prefs?: RecipeQueryPreferences,
  ): Promise<ResolvedRecipe | null> {
    // Backward-compatible bridge: compose a meal-aware query ONLY when BOTH the meal
    // slot AND the search preferences are supplied (the 12-04 path). Otherwise the query
    // is the bare meal name — the pre-12-03 behavior the recipe-handler still relies on.
    const query = mealType && prefs ? buildRecipeQuery(mealName, mealType, prefs) : mealName;
    const queryKey = query.toLowerCase().trim();
    const cached = this.recipeRepository.getByQuery(queryKey);

    if (cached && this.isFresh(cached)) {
      return cached;
    }

    const fetched = await this.recipeSource.find(query);

    if (fetched) {
      const refreshed: CachedRecipe = {
        id: cached?.id ?? randomUUID(),
        queryKey,
        name: fetched.name,
        ingredients: fetched.ingredients,
        steps: fetched.steps,
        sourceUrl: fetched.sourceUrl,
        sourceUrlValid: true,
        cachedAt: Date.now(),
      };
      this.recipeRepository.cache(refreshed);
      return refreshed;
    }

    if (cached) {
      this.recipeRepository.markSourceDead(cached.id);
      return { ...cached, sourceUrlValid: false };
    }

    return null;
  }

  private isFresh(recipe: CachedRecipe): boolean {
    return Date.now() - recipe.cachedAt < TTL_MS;
  }
}
