/**
 * RulesClassifier — pure, dependency-free first pass of hybrid categorisation.
 *
 * Case-insensitive keyword matching on the raw German productType. Returns the
 * first matching rule's bucket, or null when nothing matches (defer to the LLM
 * fallback). NEVER emits "Other" — that is the LLM's final bucket only.
 *
 * PRECEDENCE matters: frozen (TK) markers are checked BEFORE meat/fish, so a
 * "TK Fleisch/Fisch - Rind" product classifies as Frozen, not Meat & Fish.
 *
 * Matching modes per stem:
 *   - string  → plain case-insensitive substring (catches compounds, e.g.
 *               "Salat" in "Blattsalate", "Wurst" in "Wurstwaren").
 *   - RegExp  → boundary match. Used for the two Frozen markers that would
 *               otherwise fire as false substrings:
 *                 \btk\b  — plain "tk" matches "schni-ttk-äse" (Schnittkäse);
 *                 \beis\b — plain "eis" matches "fl-eis-ch" (Fleisch).
 *               Both German markers ("TK ", "- Eis") appear as standalone tokens,
 *               so a word-boundary match is correct. Applied to the lowercased input.
 */

import type { TaxonomyCategory } from "../shared/types.ts";

type Stem = string | RegExp;

interface Rule {
  stems: Stem[];
  category: TaxonomyCategory;
}

/**
 * Ordered rules — first match wins. Frozen first (TK precedence over meat/fish).
 * Stems are lowercase so comparison is against the lowercased input.
 */
const RULES: readonly Rule[] = [
  // 1. FROZEN first — TK precedence. "tk"/"eis" boundary-matched (avoid
  //    "schnittkäse"/"fleisch" false positives); "tiefkühl" stays substring.
  { stems: [/\btk\b/, "tiefkühl", /\beis\b/], category: "Frozen" },
  // 2. Household
  { stems: ["reiniger", "wasch", "drogerie"], category: "Household" },
  // 3. Produce
  { stems: ["salat"], category: "Produce" },
  // 4. Meat & Fish (incl. vegan meat substitutes — protein aisle)
  {
    stems: [
      "fleisch", "geflügel", "hühnchen", "hackfleisch", "wurst", "fleischersatz",
      "fisch", "meeresfrüchte",
    ],
    category: "Meat & Fish",
  },
  // 5. Dairy & Cheese
  { stems: ["käse"], category: "Dairy & Cheese" },
  // 6. Bakery
  { stems: ["brot", "bäck", "bake-off", "gebäck", "kuchen"], category: "Bakery" },
  // 7. Pantry
  {
    stems: [
      "konserven", "dressing", "öl", "soße", "ketchup", "senf",
      "nüsse", "trockenfrüchte", "aufstrich", "dip",
    ],
    category: "Pantry",
  },
  // 8. Snacks & Sweets
  { stems: ["chips", "snack"], category: "Snacks & Sweets" },
  // 9. Drinks — "wein" boundary-guarded with a negative lookbehind so it does
  //    NOT false-match "schwein" (pork), while still catching "rotwein"/
  //    "weißwein"/"weinschorle". Same false-substring guard as \btk\b/\beis\b.
  { stems: ["saft", "sirup", "sekt", "schaumwein", /(?<!sch)wein/, "bier", "radler"], category: "Drinks" },
];

export class RulesClassifier {
  /**
   * Classify a raw German productType. Returns a bucket, or null for no match
   * (including the literal "unknown") — the caller defers null rows to the LLM.
   */
  classify(productType: string): TaxonomyCategory | null {
    const lower = productType.toLowerCase();
    for (const rule of RULES) {
      for (const stem of rule.stems) {
        const hit = typeof stem === "string" ? lower.includes(stem) : stem.test(lower);
        if (hit) {
          return rule.category;
        }
      }
    }
    return null;
  }
}
