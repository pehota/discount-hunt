/**
 * RulesClassifier unit tests — example-based mapping of ACTUAL DB productType
 * strings to their expected taxonomy bucket, plus the null (defer-to-LLM) path
 * and a membership guard over every non-null output.
 *
 * bypass: pure keyword-mapping is example-based (specific input→bucket); the
 * property (every output ∈ TAXONOMY_CATEGORIES) is asserted separately.
 */

import { describe, test, expect } from "bun:test";
import { RulesClassifier } from "./rules-classifier.ts";
import { TAXONOMY_CATEGORIES, isTaxonomyCategory } from "../shared/types.ts";

const rules = new RulesClassifier();

const CASES: ReadonlyArray<[productType: string, expected: string]> = [
  ["Salate - Blattsalate", "Produce"],
  ["Frischfleisch/-geflügel/-fisch - Hackfleisch", "Meat & Fish"],
  ["Geflügel frisch - Hühnchen", "Meat & Fish"],
  ["Gekühlte Wurstwaren - Würstchen", "Meat & Fish"],
  ["Käse/Käseersatzprodukte - Schnittkäse", "Dairy & Cheese"],
  ["Bake-Off - Feinbackwaren", "Bakery"],
  ["Bake-Off - Schwarz-/Vollkornbrot", "Bakery"],
  ["Brot/Kuchen - Frischbrot", "Bakery"],
  ["Gebäck - Gebäck", "Bakery"],
  ["Konserven - Gemüsekonserven", "Pantry"],
  ["Dressings/Öle/Soßen - Ketchup/Senf", "Pantry"],
  ["Nüsse/Trockenfrüchte - Nüsse", "Pantry"],
  ["Gekühlte Feinkost - Aufstriche/Dips", "Pantry"],
  ["Chips/Snacks - Chips", "Snacks & Sweets"],
  ["Fruchtsäfte/Sirupe - Fruchtsaft", "Drinks"],
  ["Sekt/Schaumwein - Sekt", "Drinks"],
  // Wine stems — legitimate wine compounds MUST classify as Drinks.
  ["Wein - Rotwein", "Drinks"],
  ["Wein - Weißwein", "Drinks"],
  // Frozen — TK precedence: these contain meat/fish stems but MUST be Frozen.
  ["TK Desserts/Backwaren/Eis - Eis", "Frozen"],
  ["TK Fleisch/Fisch - Fisch/Meeresfrüchte", "Frozen"],
  ["TK Fleisch/Fisch - Rind", "Frozen"],
  // Fleischersatz — vegan meat substitute sits in the protein aisle (Meat & Fish),
  // and "Fleisch" must NOT be misrouted to Frozen by a naive "eis" substring.
  ["Gekühltes verzehrfertiges Fleisch - Fleischersatzprodukte", "Meat & Fish"],
];

describe("RulesClassifier.classify", () => {
  for (const [productType, expected] of CASES) {
    test(`"${productType}" → ${expected}`, () => {
      expect(rules.classify(productType)).toBe(expected as (typeof TAXONOMY_CATEGORIES)[number]);
    });
  }

  test('"unknown" → null (defer to LLM)', () => {
    expect(rules.classify("unknown")).toBeNull();
  });

  test('"schwein" (pork) does NOT false-match the Drinks "wein" stem', () => {
    // "Schweinerücken" hits no meat/other stem, so it must defer (null) — and
    // crucially must NOT be classified as Drinks via a naive "wein" substring
    // inside "schwein". (A preceding meat rule would also be acceptable; here
    // none matches, so null is the correct deferral.)
    expect(rules.classify("Schweinerücken")).not.toBe("Drinks");
    expect(rules.classify("Schweinerücken")).toBeNull();
  });

  test("every non-null output is a valid TaxonomyCategory and never 'Other'", () => {
    for (const [productType] of CASES) {
      const bucket = rules.classify(productType);
      expect(bucket).not.toBeNull();
      // Guard-based membership (strict-mode safe).
      expect(isTaxonomyCategory(bucket as string)).toBe(true);
      expect(TAXONOMY_CATEGORIES).toContain(bucket as (typeof TAXONOMY_CATEGORIES)[number]);
      expect(bucket).not.toBe("Other");
    }
  });
});
