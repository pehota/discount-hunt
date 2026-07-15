/**
 * Pure recipe-query composer (design phase 12, step 12-03).
 *
 * Composes a German search query from a meal name, its slot, and the user's
 * recipe-search preferences. Meal-aware: the slot term biases dinner away from
 * dessert-style results ("Abendessen") and lunch toward midday meals ("Mittagessen").
 *
 * Contract shape: pure-function / return-only — no I/O, no side-effects.
 */

import type { DietaryRestriction, MealSlot } from "../shared/types.ts";

export interface RecipeQueryPreferences {
  dietaryRestriction: DietaryRestriction;
  kidFriendly: boolean;
  householdSize: number;
  cookingTime: "any" | "quick";
}

const MEAL_TYPE_TERM: Record<MealSlot, string> = {
  lunch: "Mittagessen",
  dinner: "Abendessen",
};

const DIETARY_TERM: Record<DietaryRestriction, string> = {
  vegetarian: "vegetarisch",
  vegan: "vegan",
  none: "",
};

/**
 * Compose the German recipe search query in a stable order, dropping falsy
 * terms and joining with single spaces:
 *   [ mealName, mealTypeTerm, dietaryTerm?, "kinderfreundlich"?,
 *     "für N Personen"?, "schnell"?, "Rezept" ]
 */
export function buildRecipeQuery(
  mealName: string,
  mealType: MealSlot,
  prefs: RecipeQueryPreferences,
): string {
  const terms = [
    mealName,
    MEAL_TYPE_TERM[mealType],
    DIETARY_TERM[prefs.dietaryRestriction],
    prefs.kidFriendly ? "kinderfreundlich" : "",
    prefs.householdSize > 1 ? `für ${prefs.householdSize} Personen` : "",
    prefs.cookingTime === "quick" ? "schnell" : "",
    "Rezept",
  ];

  return terms.filter((term) => term).join(" ");
}
