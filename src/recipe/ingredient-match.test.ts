/**
 * ingredient-match — CHARACTERIZATION tests for the pure ingredient↔discount
 * matching heuristic extracted from recipe-handler.ts (step 08-08, closes review
 * WARNING B13). Design §9.
 *
 * These tests document ACTUAL current behavior of the heuristic — they are NOT a
 * spec of desired behavior. Where the heuristic over-matches (a documented §9
 * failure mode), the test pins the real outcome and flags it `known limitation §9`.
 * Do NOT "fix" the heuristic to satisfy an intuition — the recipe-detail
 * highlighting ATs pin this exact behavior and must stay green.
 *
 * Heuristic recap (design §9):
 *   - case-insensitive; split on non-[a-zäöüß0-9] runs
 *   - drop unit stop-words and pure-digit tokens
 *   - keep only tokens of length ≥ 4 (MIN_TOKEN_LENGTH)
 *   - two strings overlap if any surviving token of one equals OR is a substring of
 *     a surviving token of the other (either direction)
 *   - matchIngredient: FIRST week-item whose name overlaps the ingredient wins; else null
 */

import { describe, test, expect } from "bun:test";
import { matchIngredient, tokensOverlap } from "./ingredient-match.ts";

/** Minimal week-item shape the matcher reads (subset of StoredDiscountItem). */
function item(name: string, store = "Aldi Süd", salePrice = 129) {
  return { store, name, salePrice };
}

describe("tokensOverlap — the pure §9 predicate", () => {
  // ── exact / same-token cases ────────────────────────────────────────────────
  test.each<[string, string, boolean, string]>([
    ["Rote Linsen", "Rote Linsen", true, "identical multi-token strings share every token"],
    ["Rote Linsen", "Linsen", true, "shared exact token 'linsen' (containment: item ⊂ ingredient)"],
    ["Linsen", "Rote Linsen", true, "direction-symmetric: same match with args swapped"],
    ["Kokosmilch", "Zucchini", false, "no shared / substring token → no overlap"],
  ])("tokensOverlap(%o, %o) === %o  — %s", (a, b, expected) => {
    expect(tokensOverlap(a, b)).toBe(expected);
  });

  // ── short-token guard (length < 4 tokens are dropped before comparison) ──────
  test("short tokens (<4 chars) are filtered, so 'Ei' cannot match 'Eis'", () => {
    // significantTokens("Ei")  → []  (len 2 < 4)
    // significantTokens("Eis") → []  (len 3 < 4) — BOTH sides empty → no overlap.
    expect(tokensOverlap("Ei", "Eis")).toBe(false);
  });

  test("KNOWN LIMITATION §9: 'Reis' (len 4) is a substring of 'Preiselbeeren' → false-positive MATCH", () => {
    // significantTokens("Reis")          → ["reis"]           (len 4 ≥ 4, survives)
    // significantTokens("Preiselbeeren") → ["preiselbeeren"]
    // "preiselbeeren".includes("reis") is TRUE (at index 1) → the heuristic OVER-matches.
    // This is a documented §9 short-token-over-match failure mode. Characterized, NOT fixed.
    expect(tokensOverlap("Reis", "Preiselbeeren")).toBe(true);
  });

  test("unit / quantity stop-words and pure-digit tokens do not drive matches", () => {
    // "500 g Linsen" → significant tokens = ["linsen"] ("500" digit-dropped, "g" stop-word).
    // A bare quantity/unit string has NO significant tokens → never overlaps.
    expect(tokensOverlap("500 g", "200 g")).toBe(false);
    expect(tokensOverlap("500 g Linsen", "Linsen")).toBe(true);
  });
});

describe("matchIngredient — first-week-item-wins over the week feed", () => {
  const weekItems = [
    item("Zucchini", "Aldi Süd", 99),
    item("Rote Linsen", "Aldi Süd", 129),
    item("Linsen Suppe", "Lidl", 149),
  ];

  test("exact match returns the FIRST overlapping item's store + salePrice", () => {
    // "Rote Linsen" overlaps items[1] ("Rote Linsen") first — items[2] also overlaps
    // via "linsen", but first-match-wins keeps items[1].
    expect(matchIngredient("Rote Linsen", weekItems)).toEqual({ store: "Aldi Süd", salePrice: 129 });
  });

  test("compound/containment: ingredient 'Rote Linsen' matches item named just 'Linsen'", () => {
    const found = matchIngredient("Rote Linsen", [item("Linsen", "Lidl", 88)]);
    expect(found).toEqual({ store: "Lidl", salePrice: 88 });
  });

  test("no overlapping week item → null", () => {
    expect(matchIngredient("Kokosmilch", weekItems)).toBeNull();
  });

  test("empty week feed → null", () => {
    expect(matchIngredient("Rote Linsen", [])).toBeNull();
  });

  test("first-match-wins is order-sensitive: reordering the feed changes which item is returned", () => {
    const reordered = [item("Linsen Suppe", "Lidl", 149), item("Rote Linsen", "Aldi Süd", 129)];
    // Now "Linsen Suppe" (Lidl) overlaps "Rote Linsen" first → Lidl wins.
    expect(matchIngredient("Rote Linsen", reordered)).toEqual({ store: "Lidl", salePrice: 149 });
  });

  test("KNOWN LIMITATION §9: 'Reis' matches 'Preiselbeeren' item (substring over-match)", () => {
    const found = matchIngredient("Reis", [item("Preiselbeeren", "Rewe", 199)]);
    expect(found).toEqual({ store: "Rewe", salePrice: 199 });
  });
});
