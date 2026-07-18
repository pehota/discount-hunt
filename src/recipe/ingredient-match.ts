/**
 * ingredient-match — the pure ingredient↔discount matching heuristic (design §9).
 *
 * Extracted from recipe-handler.ts (step 08-08, closes review WARNING B13) so the
 * heuristic is unit-testable in isolation: case-insensitive, unit/quantity stop-words
 * dropped, length-≥4 token guard, WHOLE-TOKEN (word-boundary) overlap, first-week-item-wins.
 *
 * Display-only heuristic — a miss is cosmetic and NEVER affects savings math (the
 * DietaryVerifier is the real safety gate). The §9 short-token substring over-match
 * ("Reis" ⊂ "Preiselbeeren", "hack" ⊂ "gehackt") is FIXED via the word-boundary rule
 * in tokensOverlap (SPIKE UC-2); remaining failure modes (plurals, compounds) stay
 * characterized in ingredient-match.test.ts.
 */

/** The subset of a week discount item the matcher reads (StoredDiscountItem is a superset). */
export type WeekItemLike = {
  store: string;
  name: string;
  salePrice: number;
};

/** Minimum ingredient-token length considered significant (design §9, length-≥4 rule). */
const MIN_TOKEN_LENGTH = 4;

/** German quantity/unit stop-list stripped before matching (design §9). */
const UNIT_STOP_LIST = new Set([
  "g", "kg", "ml", "l", "el", "tl", "stk", "prise", "stück", "dose", "packung",
]);

/**
 * Normalizes a string for matching: lowercase, split on whitespace/punctuation,
 * drop leading quantity tokens and unit stop-words, keep tokens of length ≥ 4.
 */
function significantTokens(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-zäöüß0-9]+/i)
    .filter((token) => token.length > 0 && !UNIT_STOP_LIST.has(token) && !/^\d+$/.test(token))
    .filter((token) => token.length >= MIN_TOKEN_LENGTH);
}

/**
 * True when a and b share a whole significant token (word-boundary equality).
 *
 * Word-boundary rule (SPIKE UC-2): two tokens overlap only if they are the SAME
 * whole token after normalization/lowercasing — NOT if one is a substring of the
 * other. This kills the §9 short-token substring over-match ("reis" ⊄ "preiselbeeren",
 * "hack" ⊄ "gehackt") while preserving genuine whole-token matches ("Rote Linsen"
 * vs "Linsen" still share the whole token "linsen").
 */
export function tokensOverlap(a: string, b: string): boolean {
  const tokensA = new Set(significantTokens(a));
  for (const tb of significantTokens(b)) {
    if (tokensA.has(tb)) {
      return true;
    }
  }
  return false;
}

/**
 * The first this-week discount item whose name token-overlaps `ingredient` wins;
 * else null. Returns only the display fields (store + salePrice).
 */
export function matchIngredient(
  ingredient: string,
  weekItems: WeekItemLike[],
): { store: string; salePrice: number } | null {
  const match = weekItems.find((item) => tokensOverlap(ingredient, item.name)) ?? null;
  return match ? { store: match.store, salePrice: match.salePrice } : null;
}
