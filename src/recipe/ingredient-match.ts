/**
 * ingredient-match — the pure ingredient↔discount matching heuristic (design §9).
 *
 * Extracted verbatim from recipe-handler.ts (step 08-08, closes review WARNING B13)
 * so the heuristic is unit-testable in isolation. Behavior is IDENTICAL to the prior
 * in-handler implementation: case-insensitive, unit/quantity stop-words dropped,
 * length-≥4 token guard, substring-either-direction overlap, first-week-item-wins.
 *
 * Display-only heuristic — a miss (or a §9 over-match) is cosmetic and NEVER affects
 * savings math. Documented failure modes (plurals, compounds, short-token substring
 * over-match) are characterized in ingredient-match.test.ts, not "fixed" here.
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

/** True when any significant token of a matches/contains a significant token of b (either direction). */
export function tokensOverlap(a: string, b: string): boolean {
  const tokensA = significantTokens(a);
  const tokensB = significantTokens(b);
  for (const ta of tokensA) {
    for (const tb of tokensB) {
      if (ta === tb || ta.includes(tb) || tb.includes(ta)) {
        return true;
      }
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
