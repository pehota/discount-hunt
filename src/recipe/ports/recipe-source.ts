/**
 * RecipeSource — driven port (the single testability seam for recipe lookup).
 *
 * Prod wires ChefkochRecipeSource (live network); tests wire an in-memory fake.
 * RecipeService depends on THIS port, never on Chefkoch (design §3).
 *
 * Read-only by design: a "find" seam must not be able to mutate — there is no
 * write method here. `find` returns null when the source produces nothing usable
 * (no search hit, or the page has no @type:"Recipe" JSON-LD). It never throws into
 * the domain — any HTTP/parse failure surfaces as null.
 */

export interface FetchedRecipe {
  name: string;
  ingredients: string[]; // recipeIngredient[] — German free text, stored as-is
  steps: string[]; // flattened recipeInstructions (HowToStep text)
  sourceUrl: string; // recipe.url ?? recipe.mainEntityOfPage
}

export interface RecipeSource {
  find(query: string): Promise<FetchedRecipe | null>;
}
