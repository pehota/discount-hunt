/**
 * FakeRecipeSource — in-memory double for the source-agnostic `RecipeSource` port.
 *
 * Driven-external port per the ATDD Infrastructure Policy: recipe discovery is a non-deterministic
 * external boundary (Chefkoch), so acceptance tests inject this fake via the
 * `recipeSource` param that `createServer` already accepts. NO network, NO I/O.
 *
 * Constructed with a Map<queryKeySubstring, FetchedRecipe | null>. `find` matches by substring
 * (the composed query contains the bare key), records calls for spy assertions, and returns null
 * for the no-match / dead-source / degraded path. Mirrors the inline fake in recipe-detail.test.ts,
 * promoted to support/ for reuse across the meal-plan-engine suite (SSOT — one fake).
 */

import type { RecipeSource, FetchedRecipe } from "../../../src/recipe/ports/recipe-source.ts";

export class FakeRecipeSource implements RecipeSource {
  public readonly calls: string[] = [];
  constructor(private readonly canned: Map<string, FetchedRecipe | null>) {}

  async find(query: string): Promise<FetchedRecipe | null> {
    this.calls.push(query);
    const normalized = query.toLowerCase().trim();
    for (const [cannedKey, recipe] of this.canned) {
      if (normalized.includes(cannedKey.toLowerCase())) {
        return recipe;
      }
    }
    return null;
  }
}

/** A recipe that is dietary-safe and uses a named discounted anchor — for happy-path candidates. */
export function vegRecipe(
  name: string,
  ingredients: string[],
  sourceUrl = "https://example.test/recipe",
): FetchedRecipe {
  return { name, ingredients, steps: ["Mix.", "Cook.", "Serve."], sourceUrl };
}

/** A recipe with a hidden non-veg ingredient — the DietaryVerifier must reject it (never surface). */
export function meatLieRecipe(
  name: string,
  nonVegIngredient: string,
  sourceUrl = "https://example.test/lie",
): FetchedRecipe {
  return {
    name,
    ingredients: ["200 g Nudeln", nonVegIngredient, "1 Zwiebel"],
    steps: ["Mix.", "Cook."],
    sourceUrl,
  };
}
