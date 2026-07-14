/**
 * Shared Kernel — dietary compatibility predicate.
 *
 * isCompatible(tags, restriction) is the single source of truth for dietary filtering.
 * Consumed by: Discount dashboard (GET /), GeneratePlan (plan-service), recipe display.
 * Import-linter rule: no other file may reimplement this predicate (D33).
 *
 * Contract shape: pure-function / return-only.
 * Universe: input tags[] + restriction only; no side effects.
 */

import type { DietaryTag, DietaryRestriction } from "./types.ts";

/**
 * Returns true if an item tagged with `tags` is compatible with `restriction`.
 *
 * Rules:
 *   - "none" restriction: always compatible
 *   - "vegetarian": compatible unless tags contains "contains-meat" or "contains-fish"
 *   - "vegan": compatible only if tags contains "vegan"
 */
export function isCompatible(tags: DietaryTag[], restriction: DietaryRestriction): boolean {
  if (restriction === "none") {
    return true;
  }
  if (restriction === "vegetarian") {
    return !tags.includes("contains-meat") && !tags.includes("contains-fish");
  }
  // vegan
  return tags.includes("vegan");
}
