/**
 * DietaryVerifier — RED scaffold (created by DISTILL, meal-plan-engine D40).
 *
 * Deterministic word-boundary (German-focused) non-veg blocklist over FULL fetched
 * ingredient lists + title. Second-line defense-in-depth after the forced `vegetarisch`
 * query term. Pure function — no I/O. NOT the `tokensOverlap` display heuristic.
 *
 * Source = Chefkoch (single German source, ADR-008 superseded). SPIKE RUN-5 proved the forced
 * `vegetarisch` term flips leaks 40%→0% ON CHEFKOCH; the verifier is defense-in-depth. Residual
 * leak measured over the first weeks in real use (recommended, not a blocking gate).
 */

export const __SCAFFOLD__ = true;

import type { FetchedRecipe } from "./ports/recipe-source.ts";
import type { DietaryRestriction } from "../shared/types.ts";

export interface DietaryVerdict {
  readonly safe: boolean;
  readonly offendingKeyword: string | null;
  readonly lang: "de" | "en" | null;
}

/**
 * Verify a fetched recipe against a dietary restriction over its full ingredient list + title.
 * Returns pass/reject + the offending keyword (for the guardrail.dietary.violation event).
 * A recipe with no parseable ingredients is REJECTED (cannot verify → never surface).
 */
export function verifyDietary(
  recipe: FetchedRecipe,
  restriction: DietaryRestriction,
): DietaryVerdict {
  throw new Error("Not yet implemented — RED scaffold");
}
