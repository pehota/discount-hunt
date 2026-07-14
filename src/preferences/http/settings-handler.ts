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
import type { DietaryRestriction } from "../../shared/types.ts";

const DIETARY_OPTIONS: Array<{ value: DietaryRestriction; label: string }> = [
  { value: "none", label: "None" },
  { value: "vegetarian", label: "Vegetarian" },
  { value: "vegan", label: "Vegan" },
];

const VALID_DIETARY_VALUES: readonly DietaryRestriction[] = ["none", "vegetarian", "vegan"];

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

function renderSettingsHtml(
  current: DietaryRestriction,
  budgetCapCents: number | null | undefined,
  savedBanner: boolean,
): string {
  const options = DIETARY_OPTIONS.map(({ value, label }) => {
    const selected = value === current ? " selected" : "";
    return `<option value="${value}"${selected}>${label}</option>`;
  }).join("\n        ");

  const banner = savedBanner
    ? `<p class="settings-saved">Settings saved</p>`
    : "";

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>Preferences</title></head>
<body>
  <h1>Preferences</h1>
  ${banner}
  <form method="POST" action="/settings">
    <label for="dietary">Dietary restriction</label>
    <select name="dietary" id="dietary">
        ${options}
    </select>
    <label for="budget">Weekly budget (€)</label>
    <input type="number" name="budget" id="budget" min="0" step="0.01" value="${budgetEurosValue(budgetCapCents)}">
    <button type="submit">Save</button>
  </form>
</body>
</html>`;
}

export class SettingsHandler {
  constructor(private readonly preferencesService: PreferencesService) {}

  handleGet(_request: Request): Response {
    const { dietaryRestriction, budgetCapCents } = this.preferencesService.getPreferences();
    return this.htmlResponse(renderSettingsHtml(dietaryRestriction, budgetCapCents, false));
  }

  async handlePost(request: Request): Promise<Response> {
    const form = new URLSearchParams(await request.text());
    const dietary = parseDietaryRestriction(form.get("dietary"));
    const budgetCapCents = parseBudgetCapCents(form.get("budget"));
    this.preferencesService.updatePreferences({ dietaryRestriction: dietary, budgetCapCents });
    return this.htmlResponse(renderSettingsHtml(dietary, budgetCapCents, true));
  }

  private htmlResponse(html: string): Response {
    return new Response(html, {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }
}
