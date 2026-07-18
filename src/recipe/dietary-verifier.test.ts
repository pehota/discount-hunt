/**
 * DietaryVerifier — collocated pure-unit tests (layer 1). RED against the scaffold.
 *
 * Mandate 9: PBT full at layer 1 (fast-check). Mandate 8: pure spec, no state mutation ->
 * assert return values (no state-delta). This is the JOB-003 safety gate — the German non-veg
 * gold corpus (EN families kept as harmless extra coverage) + word-boundary no-over-match are
 * load-bearing (100%-no-violation constraint).
 *
 * Source = Chefkoch (single German source, ADR-008 reverted). SPIKE RUN-5's forced-`vegetarisch`
 * 0-leak proof holds on Chefkoch; the verifier is defense-in-depth. Residual leak is measured over
 * the first weeks in real use (recommended, not a blocking pre-ship gate).
 */

import { describe, test, expect } from "bun:test";
import * as fc from "fast-check";
import { verifyDietary } from "./dietary-verifier.ts";
import { vegRecipe, meatLieRecipe } from "../../tests/acceptance/support/fake-recipe-source.ts";
import {
  NON_VEG_GOLD_REJECT,
  WORD_BOUNDARY_SAFE,
} from "../../tests/acceptance/support/meal-plan-domain.ts";

describe("DietaryVerifier — the RUN-4 known lies are rejected (DE gold corpus)", () => {
  test("Brokkoli-Nudel-Gratin listing Schinken is rejected under vegetarian", () => {
    const verdict = verifyDietary(meatLieRecipe("Brokkoli-Nudel-Gratin", "200 g Schinken, gewürfelt"), "vegetarian");
    expect(verdict.safe).toBe(false);
    expect(verdict.offendingKeyword?.toLowerCase()).toContain("schinken");
  });

  test("Gefülltes Schnitzel listing Kalbsbrät is rejected under vegetarian", () => {
    const verdict = verifyDietary(meatLieRecipe("Gefülltes Schnitzel", "200 g Kalbsbrät"), "vegetarian");
    expect(verdict.safe).toBe(false);
  });
});

describe("DietaryVerifier — every DE+EN non-veg family keyword is rejected", () => {
  const families = [...NON_VEG_GOLD_REJECT.de, ...NON_VEG_GOLD_REJECT.en];

  test("no non-veg keyword ever passes as vegetarian-safe", () => {
    fc.assert(
      fc.property(fc.constantFrom(...families), (keyword) => {
        const verdict = verifyDietary(meatLieRecipe(`Rezept mit ${keyword}`, `100 g ${keyword}`), "vegetarian");
        return verdict.safe === false;
      }),
      { numRuns: families.length * 4 },
    );
  });
});

describe("DietaryVerifier — word-boundary: vegetarian ingredients are NOT over-matched", () => {
  test("Preiselbeeren / gehackt / chamomile / Reis are safe (no substring over-match)", () => {
    fc.assert(
      fc.property(fc.constantFrom(...WORD_BOUNDARY_SAFE), (safeIngredient) => {
        const verdict = verifyDietary(vegRecipe("Vegetarisches Rezept", ["1 Zwiebel", safeIngredient, "Salz"]), "vegetarian");
        return verdict.safe === true;
      }),
      { numRuns: WORD_BOUNDARY_SAFE.length * 4 },
    );
  });
});

describe("DietaryVerifier — a recipe with no parseable ingredients cannot be verified and is rejected", () => {
  test("empty ingredient list is rejected (cannot verify -> never surface)", () => {
    const verdict = verifyDietary(vegRecipe("Mystery dish", []), "vegetarian");
    expect(verdict.safe).toBe(false);
  });
});

describe("DietaryVerifier — a genuinely vegetarian recipe passes", () => {
  test("Rote Linsen-Dal with only vegetarian ingredients is safe", () => {
    const verdict = verifyDietary(
      vegRecipe("Rote Linsen-Dal", ["200 g Rote Linsen", "2 Campari Tomaten", "Kokosmilch", "Currypaste"]),
      "vegetarian",
    );
    expect(verdict.safe).toBe(true);
  });
});
