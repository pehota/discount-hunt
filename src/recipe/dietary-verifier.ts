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

import type { FetchedRecipe } from "./ports/recipe-source.ts";
import type { DietaryRestriction } from "../shared/types.ts";

export interface DietaryVerdict {
  readonly safe: boolean;
  readonly offendingKeyword: string | null;
  readonly lang: "de" | "en" | null;
}

/**
 * The non-veg blocklist SSOT. Word-boundary tokens (single) + whitespace-bounded phrases
 * (multi-word, e.g. "ground meat"). The acceptance-support NON_VEG_GOLD_REJECT is a subset.
 */
const NON_VEG: { readonly de: readonly string[]; readonly en: readonly string[] } = {
  de: [
    "Schinken", "Speck", "Wurst", "Salami", "Hackfleisch",
    "Rind", "Kalb", "Kalbsbrät", "Gulasch",
    "Hähnchen", "Huhn", "Pute", "Geflügel",
    "Fisch", "Lachs", "Thunfisch", "Hering", "Garnele", "Gelatine",
  ],
  en: [
    "ham", "bacon", "pork", "sausage", "salami",
    "beef", "veal", "mince", "ground meat",
    "chicken", "turkey", "poultry",
    "fish", "salmon", "tuna", "shrimp", "prawn", "gelatin",
  ],
};

/**
 * Tokenize into lowercased Unicode-letter words, treating äöüß as letters, and re-join
 * into a space-padded string. Padding gives word-boundary matching for free: a single-word
 * needle `" reis "` never matches inside `" preiselbeeren "`, and a multi-word needle
 * `" ground meat "` still matches a normalized phrase.
 */
function paddedTokens(text: string): string {
  const tokens = text.toLowerCase().match(/[a-zäöüß]+/g) ?? [];
  return ` ${tokens.join(" ")} `;
}

function firstOffender(
  haystack: string,
  keywords: readonly string[],
): string | null {
  for (const keyword of keywords) {
    const needle = ` ${paddedTokens(keyword).trim()} `;
    if (haystack.includes(needle)) {
      return keyword;
    }
  }
  return null;
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
  const gatesMeat = restriction === "vegetarian" || restriction === "vegan";
  if (!gatesMeat) {
    return { safe: true, offendingKeyword: null, lang: null };
  }

  const hasParseableIngredients = recipe.ingredients.some(
    (line) => line.trim().length > 0,
  );
  if (!hasParseableIngredients) {
    return { safe: false, offendingKeyword: null, lang: null };
  }

  const haystack = paddedTokens([recipe.name, ...recipe.ingredients].join(" "));

  const deOffender = firstOffender(haystack, NON_VEG.de);
  if (deOffender !== null) {
    return { safe: false, offendingKeyword: deOffender, lang: "de" };
  }

  const enOffender = firstOffender(haystack, NON_VEG.en);
  if (enOffender !== null) {
    return { safe: false, offendingKeyword: enOffender, lang: "en" };
  }

  return { safe: true, offendingKeyword: null, lang: null };
}
