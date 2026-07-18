/**
 * RecipeCandidateProviderAdapter — SHELL implementation of the RecipeCandidateProvider driving port.
 *
 * For each product in the basket, composes a forced-vegetarisch German query (buildRecipeQuery,
 * REUSED — the German `vegetarisch` term is forced regardless of the user's restriction as a
 * first-line meat filter) and looks it up through the shipped RecipeSource seam (ChefkochRecipeSource
 * in prod, FakeRecipeSource in tests). Every FetchedRecipe is then run through verifyDietary
 * (REUSED, defense-in-depth). Rejected recipes and recipes with no parseable ingredients are DROPPED.
 * On a verifier rejection a `guardrail.dietary.violation` structured event is emitted (logger, REUSED).
 *
 * A surviving candidate carries the discountItemIds whose product name appears in the recipe's
 * ingredient lines (substring match — "Rote Linsen" ⊂ "200 g Rote Linsen"). D38 effect boundary:
 * fetch + verify are SHELL effects here; the pure generatePlan core only assembles the data.
 */

import type { StoredDiscountItem } from "../../discount/adapters/sqlite-discount-item-repository.ts";
import type { DietaryRestriction } from "../../shared/types.ts";
import type { RecipeSource, FetchedRecipe } from "../ports/recipe-source.ts";
import type { RecipeCandidateProvider, VerifiedCandidate } from "../ports/recipe-candidate-provider.ts";
import { verifyDietary } from "../dietary-verifier.ts";
import { tokensOverlap } from "../ingredient-match.ts";
import { buildRecipeQuery } from "../recipe-query.ts";
import type { Logger } from "../../shared/logger.ts";

/** Force the German meat-filter term into every query, independent of the user's restriction. */
const FORCED_DIETARY: DietaryRestriction = "vegetarian";

export class RecipeCandidateProviderAdapter implements RecipeCandidateProvider {
  constructor(
    private readonly recipeSource: RecipeSource,
    private readonly logger: Logger,
  ) {}

  async findCandidates(
    basket: readonly StoredDiscountItem[],
    restriction: DietaryRestriction,
  ): Promise<VerifiedCandidate[]> {
    const candidates: VerifiedCandidate[] = [];
    const seenSourceUrls = new Set<string>();

    for (const anchor of basket) {
      const recipe = await this.recipeSource.find(this.queryFor(anchor.name));
      if (recipe === null) continue;
      if (seenSourceUrls.has(recipe.sourceUrl)) continue;

      if (!this.hasParseableIngredients(recipe)) continue;

      const verdict = verifyDietary(recipe, restriction);
      if (!verdict.safe) {
        this.logger.log("warn", "guardrail.dietary.violation", {
          recipe: recipe.name,
          offendingKeyword: verdict.offendingKeyword ?? "",
          lang: verdict.lang ?? "",
        });
        continue;
      }

      seenSourceUrls.add(recipe.sourceUrl);
      candidates.push({
        recipeId: recipe.sourceUrl,
        title: recipe.name,
        sourceUrl: recipe.sourceUrl,
        usedDiscountItemIds: this.usedItemIds(recipe, basket),
      });
    }

    return candidates;
  }

  /** Compose the forced-vegetarisch German search query for a single product anchor. */
  private queryFor(productName: string): string {
    return buildRecipeQuery(productName, "dinner", {
      dietaryRestriction: FORCED_DIETARY,
      kidFriendly: false,
      householdSize: 1,
      cookingTime: "any",
    });
  }

  private hasParseableIngredients(recipe: FetchedRecipe): boolean {
    return recipe.ingredients.some((line) => line.trim().length > 0);
  }

  /** The basket items whose product name appears (case-insensitively) in any ingredient line. */
  private usedItemIds(
    recipe: FetchedRecipe,
    basket: readonly StoredDiscountItem[],
  ): string[] {
    return basket
      .filter((item) => recipe.ingredients.some((line) => tokensOverlap(line, item.name)))
      .map((item) => item.id);
  }
}
