/**
 * buildRecipeQuery — table-driven exact-string pins (step 12-03).
 *
 * # bypass: pure deterministic function with single string output — example-based
 * table tests pin the exact composed query per combo (pure-function PBT exemption,
 * nw-tdd-methodology "Exempt categories"). The table walks the representative combos:
 * none/veg/vegan × kid on/off × household 1 vs 4 × any/quick × lunch/dinner.
 * The meal-aware term (Mittagessen/Abendessen) is asserted explicitly below.
 */

import { describe, test, expect } from "bun:test";
import { buildRecipeQuery, type RecipeQueryPreferences } from "./recipe-query.ts";
import type { MealSlot } from "../shared/types.ts";

type Row = {
  name: string;
  mealName: string;
  mealType: MealSlot;
  prefs: RecipeQueryPreferences;
  expected: string;
};

const table: Row[] = [
  {
    name: "bare: none, no kid, household 1, any, dinner",
    mealName: "Kürbis",
    mealType: "dinner",
    prefs: { dietaryRestriction: "none", kidFriendly: false, householdSize: 1, cookingTime: "any" },
    expected: "Kürbis Abendessen Rezept",
  },
  {
    name: "bare: none, no kid, household 1, any, lunch",
    mealName: "Kürbis",
    mealType: "lunch",
    prefs: { dietaryRestriction: "none", kidFriendly: false, householdSize: 1, cookingTime: "any" },
    expected: "Kürbis Mittagessen Rezept",
  },
  {
    name: "vegetarian dinner",
    mealName: "Kürbis",
    mealType: "dinner",
    prefs: { dietaryRestriction: "vegetarian", kidFriendly: false, householdSize: 1, cookingTime: "any" },
    expected: "Kürbis Abendessen vegetarisch Rezept",
  },
  {
    name: "vegan lunch",
    mealName: "Linsen",
    mealType: "lunch",
    prefs: { dietaryRestriction: "vegan", kidFriendly: false, householdSize: 1, cookingTime: "any" },
    expected: "Linsen Mittagessen vegan Rezept",
  },
  {
    name: "kid-friendly only",
    mealName: "Nudeln",
    mealType: "lunch",
    prefs: { dietaryRestriction: "none", kidFriendly: true, householdSize: 1, cookingTime: "any" },
    expected: "Nudeln Mittagessen kinderfreundlich Rezept",
  },
  {
    name: "household 4 adds für 4 Personen",
    mealName: "Nudeln",
    mealType: "dinner",
    prefs: { dietaryRestriction: "none", kidFriendly: false, householdSize: 4, cookingTime: "any" },
    expected: "Nudeln Abendessen für 4 Personen Rezept",
  },
  {
    name: "quick adds schnell",
    mealName: "Nudeln",
    mealType: "dinner",
    prefs: { dietaryRestriction: "none", kidFriendly: false, householdSize: 1, cookingTime: "quick" },
    expected: "Nudeln Abendessen schnell Rezept",
  },
  {
    name: "all params on, vegetarian dinner household 4 quick kid",
    mealName: "Kürbis",
    mealType: "dinner",
    prefs: { dietaryRestriction: "vegetarian", kidFriendly: true, householdSize: 4, cookingTime: "quick" },
    expected: "Kürbis Abendessen vegetarisch kinderfreundlich für 4 Personen schnell Rezept",
  },
  {
    name: "all params on, vegan lunch household 4 quick kid",
    mealName: "Tofu",
    mealType: "lunch",
    prefs: { dietaryRestriction: "vegan", kidFriendly: true, householdSize: 4, cookingTime: "quick" },
    expected: "Tofu Mittagessen vegan kinderfreundlich für 4 Personen schnell Rezept",
  },
];

describe("buildRecipeQuery", () => {
  for (const row of table) {
    test(`composes exact query — ${row.name}`, () => {
      expect(buildRecipeQuery(row.mealName, row.mealType, row.prefs)).toBe(row.expected);
    });
  }

  test("meal-aware: a dinner query contains 'Abendessen'", () => {
    const query = buildRecipeQuery("Kürbis", "dinner", {
      dietaryRestriction: "none",
      kidFriendly: false,
      householdSize: 2,
      cookingTime: "any",
    });
    expect(query).toContain("Abendessen");
    expect(query).not.toContain("Mittagessen");
  });

  test("meal-aware: a lunch query contains 'Mittagessen'", () => {
    const query = buildRecipeQuery("Kürbis", "lunch", {
      dietaryRestriction: "none",
      kidFriendly: false,
      householdSize: 2,
      cookingTime: "any",
    });
    expect(query).toContain("Mittagessen");
    expect(query).not.toContain("Abendessen");
  });
});
