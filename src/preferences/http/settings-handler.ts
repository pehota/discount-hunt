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

function renderSettingsHtml(current: DietaryRestriction, savedBanner: boolean): string {
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
    <button type="submit">Save</button>
  </form>
</body>
</html>`;
}

export class SettingsHandler {
  constructor(private readonly preferencesService: PreferencesService) {}

  handleGet(_request: Request): Response {
    const { dietaryRestriction } = this.preferencesService.getPreferences();
    return this.htmlResponse(renderSettingsHtml(dietaryRestriction, false));
  }

  async handlePost(request: Request): Promise<Response> {
    const form = new URLSearchParams(await request.text());
    const dietary = (form.get("dietary") ?? "none") as DietaryRestriction;
    this.preferencesService.updatePreferences({ dietaryRestriction: dietary });
    return this.htmlResponse(renderSettingsHtml(dietary, true));
  }

  private htmlResponse(html: string): Response {
    return new Response(html, {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }
}
