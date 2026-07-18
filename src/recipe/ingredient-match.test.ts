/**
 * ingredient-match — CHARACTERIZATION tests for the pure ingredient↔discount
 * matching heuristic extracted from recipe-handler.ts (step 08-08, closes review
 * WARNING B13). Design §9.
 *
 * These tests document behavior of the heuristic. Genuine whole-token matches are
 * the recipe-detail highlighting contract and must stay green. The former §9
 * short-token substring over-match is now FIXED (SPIKE UC-2 word-boundary rule):
 * a significant token that is merely a PROPER SUBSTRING of another no longer drives
 * a match.
 *
 * Heuristic recap (design §9, post-UC-2):
 *   - case-insensitive; split on non-[a-zäöüß0-9] runs
 *   - drop unit stop-words and pure-digit tokens
 *   - keep only tokens of length ≥ 4 (MIN_TOKEN_LENGTH)
 *   - two strings overlap only if they share the SAME WHOLE surviving token
 *     (word-boundary equality — substring containment does NOT count)
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

  test("SPIKE UC-2 FIX: 'Reis' (len 4) is only a SUBSTRING of 'Preiselbeeren' → NO match", () => {
    // significantTokens("Reis")          → ["reis"]           (len 4 ≥ 4, survives)
    // significantTokens("Preiselbeeren") → ["preiselbeeren"]
    // word-boundary rule: "reis" !== "preiselbeeren" → no shared WHOLE token → no overlap.
    expect(tokensOverlap("Reis", "Preiselbeeren")).toBe(false);
  });

  test("SPIKE UC-2 FIX: 'Hack' is only a SUBSTRING of 'gehackt' → NO match", () => {
    // "gehackt".includes("hack") was TRUE under the old substring rule; the word-boundary
    // rule requires the SAME whole token, so "hack" !== "gehackt" → no overlap.
    expect(tokensOverlap("Hack", "gehackt")).toBe(false);
  });

  test("REGRESSION: a significant token being a PROPER SUBSTRING of another never drives a match", () => {
    // Construct pairs where one whole token is a strict substring of the other whole
    // token; word-boundary equality must reject every one of them.
    const properSubstringPairs: Array<[string, string]> = [
      ["reis", "preiselbeeren"],
      ["hack", "gehackt"],
      ["kern", "kerne"], // singular strictly inside plural — still no whole-token equality
      ["lauch", "knoblauch"],
    ];
    for (const [shorter, longer] of properSubstringPairs) {
      expect(longer.includes(shorter)).toBe(true); // precondition: it IS a proper substring
      expect(shorter).not.toBe(longer);
      expect(tokensOverlap(shorter, longer)).toBe(false); // yet it must NOT match
    }
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

  test("SPIKE UC-2 FIX: 'Reis' does NOT match a 'Preiselbeeren' item (substring over-match removed)", () => {
    const found = matchIngredient("Reis", [item("Preiselbeeren", "Rewe", 199)]);
    expect(found).toBeNull();
  });
});
