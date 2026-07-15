/**
 * SettingsHandler — primary HTTP adapter for the Preferences page.
 *
 * Routes:
 *   GET  /settings — renders the Preferences form, dietary value pre-selected (live from repo)
 *   POST /settings — upserts the dietary restriction, re-renders with "Settings saved"
 *
 * Thin driving adapter: no business logic, no direct DB — delegates to PreferencesService.
 * Increment 1 renders ONE field per LIVE dimension: the dietary dropdown only
 * (an inert control for a deferred dimension would be testing theater — design §0/§4).
 */

import type { PreferencesService } from "../preferences-service.ts";
import type { CookingTime, DietaryRestriction, MealSlot } from "../../shared/types.ts";
import { renderPage } from "../../shared/layout.ts";

const DIETARY_OPTIONS: Array<{ value: DietaryRestriction; label: string }> = [
  { value: "none", label: "None" },
  { value: "vegetarian", label: "Vegetarian" },
  { value: "vegan", label: "Vegan" },
];

const VALID_DIETARY_VALUES: readonly DietaryRestriction[] = ["none", "vegetarian", "vegan"];

const COOKING_TIME_OPTIONS: Array<{ value: CookingTime; label: string }> = [
  { value: "any", label: "Any" },
  { value: "quick", label: "Quick" },
];

const VALID_COOKING_TIMES: readonly CookingTime[] = ["any", "quick"];

const VALID_MEAL_SLOTS: readonly MealSlot[] = ["lunch", "dinner"];

const HOUSEHOLD_MIN = 1;
const HOUSEHOLD_MAX = 12;
const HOUSEHOLD_DEFAULT = 2;

/**
 * Whitelists an untrusted form value against the DietaryRestriction set.
 * Anything not on the whitelist (e.g. "banana", "") defaults to "none" —
 * garbage is never persisted (03-08 adversarial-review D1). The `as` cast at
 * the call site was compile-only and let invalid values through to isCompatible,
 * which treats an unknown restriction as vegan-only.
 */
function parseDietaryRestriction(raw: string | null): DietaryRestriction {
  return VALID_DIETARY_VALUES.includes(raw as DietaryRestriction)
    ? (raw as DietaryRestriction)
    : "none";
}

/**
 * Parses an untrusted euros budget field into cents, mirroring the dietary whitelist
 * discipline (03-08 D1): anything not a finite non-negative number is treated as NO cap
 * (null), never persisted as garbage. Empty/blank input means "no cap".
 * Guards the `Number("") === 0` trap by rejecting blank before the numeric parse.
 */
function parseBudgetCapCents(raw: string | null): number | null {
  if (raw === null) return null;
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  const euros = Number(trimmed);
  if (!Number.isFinite(euros) || euros < 0) return null;
  return Math.round(euros * 100);
}

/** Echoes a snapshotted cap back into the form as a euros value; empty when no cap. */
function budgetEurosValue(budgetCapCents: number | null | undefined): string {
  if (budgetCapCents === null || budgetCapCents === undefined) return "";
  return (budgetCapCents / 100).toFixed(2);
}

/** Whitelists cooking time against {any, quick}; anything else defaults to 'any'. */
function parseCookingTime(raw: string | null): CookingTime {
  return VALID_COOKING_TIMES.includes(raw as CookingTime) ? (raw as CookingTime) : "any";
}

/**
 * Parses household size: Number()-coerced, clamped to [1, 12]. Non-numeric, blank,
 * or out-of-range input defaults to 2 (mirrors the dietary/budget reject-garbage discipline).
 */
function parseHouseholdSize(raw: string | null): number {
  if (raw === null || raw.trim() === "") return HOUSEHOLD_DEFAULT;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < HOUSEHOLD_MIN || value > HOUSEHOLD_MAX) {
    return HOUSEHOLD_DEFAULT;
  }
  return value;
}

/**
 * Intersects submitted meal-type checkbox values with the valid slots {lunch, dinner}.
 * Uses getAll (checkbox groups submit multiple values). Empty/invalid selection
 * defaults to both slots. De-duplicates while preserving canonical slot order.
 */
function parseMealTypes(raw: string[]): MealSlot[] {
  const selected = VALID_MEAL_SLOTS.filter((slot) => raw.includes(slot));
  return selected.length > 0 ? selected : [...VALID_MEAL_SLOTS];
}

interface SettingsView {
  dietaryRestriction: DietaryRestriction;
  budgetCapCents: number | null | undefined;
  kidFriendly: boolean;
  householdSize: number;
  cookingTime: CookingTime;
  mealTypes: MealSlot[];
}

function renderSettingsHtml(view: SettingsView, savedBanner: boolean): string {
  const dietaryOptions = DIETARY_OPTIONS.map(({ value, label }) => {
    const selected = value === view.dietaryRestriction ? " selected" : "";
    return `<option value="${value}"${selected}>${label}</option>`;
  }).join("\n        ");

  const cookingOptions = COOKING_TIME_OPTIONS.map(({ value, label }) => {
    const selected = value === view.cookingTime ? " selected" : "";
    return `<option value="${value}"${selected}>${label}</option>`;
  }).join("\n        ");

  const kidFriendlyChecked = view.kidFriendly ? " checked" : "";

  const mealTypeCheckboxes = VALID_MEAL_SLOTS.map((slot) => {
    const checked = view.mealTypes.includes(slot) ? " checked" : "";
    const label = slot.charAt(0).toUpperCase() + slot.slice(1);
    return `<label><input type="checkbox" name="mealTypes" value="${slot}"${checked}> ${label}</label>`;
  }).join("\n        ");

  const banner = savedBanner
    ? `<p class="settings-saved">Settings saved</p>`
    : "";

  const body = `<h1>Preferences</h1>
  ${banner}
  <form method="POST" action="/settings">
    <label for="dietary">Dietary restriction</label>
    <select name="dietary" id="dietary">
        ${dietaryOptions}
    </select>
    <label for="budget">Weekly budget (€)</label>
    <input type="number" name="budget" id="budget" min="0" step="0.01" value="${budgetEurosValue(view.budgetCapCents)}">
    <label><input type="checkbox" name="kidFriendly"${kidFriendlyChecked}> Kid-friendly recipes</label>
    <label for="householdSize">Household size</label>
    <input type="number" name="householdSize" id="householdSize" min="1" max="12" value="${view.householdSize}">
    <label for="cookingTime">Cooking time</label>
    <select name="cookingTime" id="cookingTime">
        ${cookingOptions}
    </select>
    <fieldset>
      <legend>Meal types</legend>
      ${mealTypeCheckboxes}
    </fieldset>
    <button type="submit">Save</button>
  </form>`;

  return renderPage({ title: "Preferences", activeNav: "settings", body });
}

export class SettingsHandler {
  constructor(private readonly preferencesService: PreferencesService) {}

  handleGet(_request: Request): Response {
    return this.htmlResponse(renderSettingsHtml(this.currentView(), false));
  }

  async handlePost(request: Request): Promise<Response> {
    const form = new URLSearchParams(await request.text());
    const view: SettingsView = {
      dietaryRestriction: parseDietaryRestriction(form.get("dietary")),
      budgetCapCents: parseBudgetCapCents(form.get("budget")),
      kidFriendly: form.has("kidFriendly"),
      householdSize: parseHouseholdSize(form.get("householdSize")),
      cookingTime: parseCookingTime(form.get("cookingTime")),
      mealTypes: parseMealTypes(form.getAll("mealTypes")),
    };
    this.preferencesService.updatePreferences({
      dietaryRestriction: view.dietaryRestriction,
      budgetCapCents: view.budgetCapCents ?? null,
      kidFriendly: view.kidFriendly,
      householdSize: view.householdSize,
      cookingTime: view.cookingTime,
      mealTypes: view.mealTypes,
    });
    return this.htmlResponse(renderSettingsHtml(view, true));
  }

  private currentView(): SettingsView {
    const prefs = this.preferencesService.getPreferences();
    return {
      dietaryRestriction: prefs.dietaryRestriction,
      budgetCapCents: prefs.budgetCapCents,
      kidFriendly: prefs.kidFriendly ?? false,
      householdSize: prefs.householdSize ?? HOUSEHOLD_DEFAULT,
      cookingTime: prefs.cookingTime ?? "any",
      mealTypes: prefs.mealTypes ?? [...VALID_MEAL_SLOTS],
    };
  }

  private htmlResponse(html: string): Response {
    return new Response(html, {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }
}
