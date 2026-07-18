/**
 * RecipeCandidateProvider — driving port (RED scaffold, meal-plan-engine).
 *
 * Turns a basket of discounted products + a dietary restriction into a set of dietary-VERIFIED
 * recipe candidates (pure data) for the pure `generatePlan` core to assemble (D38 effect boundary:
 * fetch + verify are SHELL effects; the core stays pure). READ-ONLY — no write method
 * (Principle-12 driving-port split). Impl composes the shipped RecipeService + DietaryVerifier.
 */

export const __SCAFFOLD__ = true;

import type { StoredDiscountItem } from "../../discount/adapters/sqlite-discount-item-repository.ts";
import type { DietaryRestriction } from "../../shared/types.ts";

/** A recipe that has passed dietary verification, with the discounted products it uses. */
export interface VerifiedCandidate {
  readonly recipeId: string;
  readonly title: string;
  readonly sourceUrl: string;
  readonly usedDiscountItemIds: readonly string[];
}

export interface RecipeCandidateProvider {
  findCandidates(
    basket: readonly StoredDiscountItem[],
    restriction: DietaryRestriction,
  ): Promise<VerifiedCandidate[]>;
}
