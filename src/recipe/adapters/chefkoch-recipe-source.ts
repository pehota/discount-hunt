/**
 * ChefkochRecipeSource — LIVE driven adapter (production only) implementing RecipeSource.
 *
 * SPIKE-02 flow (findings-02-recipe-source.md, 3/3 live):
 *   1. GET https://www.chefkoch.de/suche.php?suche=<encoded query>  (Chrome UA)
 *   2. first /rezepte/<id>/<slug>.html link in the results HTML
 *   3. GET that page; extract <script type="application/ld+json"> blocks
 *   4. find @type:"Recipe" (string OR array); map name, recipeIngredient[],
 *      flatten recipeInstructions (HowToSection > HowToStep) to steps[],
 *      sourceUrl = url ?? mainEntityOfPage (Chefkoch omits url)
 *   5. any HTTP failure / missing link / missing Recipe JSON-LD → return null
 *      (never throw into the domain).
 *
 * The constructor is inert — NO network at construction (it is the default
 * `recipeSource ?? new ChefkochRecipeSource()` in the composition root). Network
 * lives only inside find(). Validated by the SPIKE-02 probe, NOT the unit suite
 * (Earned-Trust principle — the suite never hits the network, design §3/§12).
 */

import type { FetchedRecipe, RecipeSource } from "../ports/recipe-source.ts";

const CHROME_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const SEARCH_BASE = "https://www.chefkoch.de/suche.php?suche=";
const RECIPE_LINK = /\/rezepte\/\d+\/[^"'\s]+\.html/;
const JSON_LD_BLOCK = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;

interface JsonLdRecipe {
  "@type": string | string[];
  name?: string;
  url?: string;
  mainEntityOfPage?: string;
  recipeIngredient?: string[];
  recipeInstructions?: unknown;
}

export class ChefkochRecipeSource implements RecipeSource {
  constructor(private readonly fetchImpl: typeof fetch = fetch) {}

  async find(query: string): Promise<FetchedRecipe | null> {
    try {
      const recipeUrl = await this.discoverRecipeUrl(query);
      if (!recipeUrl) {
        return null;
      }
      const html = await this.getText(recipeUrl);
      if (!html) {
        return null;
      }
      const recipe = this.extractRecipe(html);
      if (!recipe) {
        return null;
      }
      return this.mapRecipe(recipe, recipeUrl);
    } catch {
      return null; // never throw into the domain
    }
  }

  private async discoverRecipeUrl(query: string): Promise<string | null> {
    const searchHtml = await this.getText(SEARCH_BASE + encodeURIComponent(query));
    if (!searchHtml) {
      return null;
    }
    const match = searchHtml.match(RECIPE_LINK);
    if (!match) {
      return null;
    }
    const path = match[0];
    return path.startsWith("http") ? path : `https://www.chefkoch.de${path}`;
  }

  private async getText(url: string): Promise<string | null> {
    const response = await this.fetchImpl(url, { headers: { "User-Agent": CHROME_UA } });
    if (!response.ok) {
      return null;
    }
    return response.text();
  }

  private extractRecipe(html: string): JsonLdRecipe | null {
    for (const block of html.matchAll(JSON_LD_BLOCK)) {
      const recipe = this.parseRecipeBlock(block[1]);
      if (recipe) {
        return recipe;
      }
    }
    return null;
  }

  private parseRecipeBlock(raw: string | undefined): JsonLdRecipe | null {
    if (!raw) {
      return null;
    }
    try {
      const parsed = JSON.parse(raw) as JsonLdRecipe;
      return this.isRecipe(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }

  private isRecipe(candidate: JsonLdRecipe): boolean {
    const type = candidate["@type"];
    if (Array.isArray(type)) {
      return type.includes("Recipe");
    }
    return type === "Recipe";
  }

  private mapRecipe(recipe: JsonLdRecipe, recipeUrl: string): FetchedRecipe {
    return {
      name: recipe.name ?? "",
      ingredients: recipe.recipeIngredient ?? [],
      steps: this.flattenInstructions(recipe.recipeInstructions),
      sourceUrl: recipe.url ?? recipe.mainEntityOfPage ?? recipeUrl,
    };
  }

  private flattenInstructions(instructions: unknown): string[] {
    if (!Array.isArray(instructions)) {
      return [];
    }
    const steps: string[] = [];
    for (const entry of instructions) {
      this.collectSteps(entry, steps);
    }
    return steps;
  }

  private collectSteps(entry: unknown, steps: string[]): void {
    if (typeof entry === "string") {
      steps.push(entry);
      return;
    }
    if (!entry || typeof entry !== "object") {
      return;
    }
    const node = entry as { "@type"?: string; text?: string; itemListElement?: unknown };
    if (node["@type"] === "HowToSection" && Array.isArray(node.itemListElement)) {
      for (const child of node.itemListElement) {
        this.collectSteps(child, steps);
      }
      return;
    }
    if (typeof node.text === "string") {
      steps.push(node.text);
    }
  }
}
