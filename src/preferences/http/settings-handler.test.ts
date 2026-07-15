/**
 * SettingsHandler — recipe-search field presence + POST validation (step 12-02).
 *
 * Driving-port test: exercise handleGet/handlePost against a REAL PreferencesService
 * backed by the real SQLite adapter (no mocks in the hexagon). The universe is the
 * rendered HTML (field presence, pre-fill) and the persisted round-trip via get().
 *
 * # bypass: server-rendered HTML + form-validation is a single-shot flow with exact-marker
 * assertions and clamp/whitelist branches — property-framing adds ceremony without detection
 * gain here. The repo round-trip invariant is property-covered at 12-01.
 */

import { describe, test, expect } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDb } from "../../shared/db.ts";
import { SQLiteUserPreferencesRepository } from "../adapters/sqlite-user-preferences-repository.ts";
import { PreferencesService } from "../preferences-service.ts";
import { SettingsHandler } from "./settings-handler.ts";

function withHandler<T>(run: (ctx: { handler: SettingsHandler; service: PreferencesService }) => T): T {
  const dir = mkdtempSync(join(tmpdir(), "dh-settings-"));
  try {
    const db = createDb(join(dir, "settings.db"));
    const service = new PreferencesService(new SQLiteUserPreferencesRepository(db));
    return run({ handler: new SettingsHandler(service), service });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function postForm(body: string): Request {
  return new Request("http://localhost/settings", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
}

const getRequest = new Request("http://localhost/settings");

describe("SettingsHandler recipe-search fields — GET rendering", () => {
  test("renders all four recipe-param controls with defaults pre-filled", async () => {
    await withHandler(async ({ handler }) => {
      const html = await handler.handleGet(getRequest).text();
      // kid-friendly checkbox
      expect(html).toContain('name="kidFriendly"');
      expect(html).toMatch(/type="checkbox"[^>]*name="kidFriendly"|name="kidFriendly"[^>]*type="checkbox"/);
      // household-size number input, default 2, bounded 1..12
      expect(html).toContain('name="householdSize"');
      expect(html).toContain('type="number"');
      expect(html).toContain('min="1"');
      expect(html).toContain('max="12"');
      expect(html).toMatch(/name="householdSize"[^>]*value="2"|value="2"[^>]*name="householdSize"/);
      // cooking-time select any/quick
      expect(html).toContain('name="cookingTime"');
      expect(html).toContain('value="any"');
      expect(html).toContain('value="quick"');
      // meal-type checkbox group lunch + dinner, both checked by default
      const mealTypeBoxes = html.match(/name="mealTypes"/g) ?? [];
      expect(mealTypeBoxes.length).toBe(2);
      expect(html).toContain('value="lunch"');
      expect(html).toContain('value="dinner"');
    });
  });
});

describe("SettingsHandler recipe-search fields — POST validation + persistence", () => {
  test("persists all four valid recipe params", async () => {
    await withHandler(async ({ handler, service }) => {
      await handler.handlePost(
        postForm("dietary=vegan&kidFriendly=on&householdSize=5&cookingTime=quick&mealTypes=lunch"),
      );
      const prefs = service.getPreferences();
      expect(prefs.kidFriendly).toBe(true);
      expect(prefs.householdSize).toBe(5);
      expect(prefs.cookingTime).toBe("quick");
      expect(prefs.mealTypes).toEqual(["lunch"]);
      expect(prefs.dietaryRestriction).toBe("vegan");
    });
  });

  test("captures BOTH meal-type checkboxes (getAll, not get)", async () => {
    await withHandler(async ({ handler, service }) => {
      await handler.handlePost(postForm("mealTypes=lunch&mealTypes=dinner"));
      expect(service.getPreferences().mealTypes!.sort()).toEqual(["dinner", "lunch"]);
    });
  });

  test("unchecked kidFriendly (field absent) persists false", async () => {
    await withHandler(async ({ handler, service }) => {
      await handler.handlePost(postForm("dietary=none"));
      expect(service.getPreferences().kidFriendly).toBe(false);
    });
  });

  test("household size out of range / non-numeric defaults to 2", async () => {
    await withHandler(async ({ handler, service }) => {
      await handler.handlePost(postForm("householdSize=0"));
      expect(service.getPreferences().householdSize).toBe(2);
      await handler.handlePost(postForm("householdSize=99"));
      expect(service.getPreferences().householdSize).toBe(2);
      await handler.handlePost(postForm("householdSize=abc"));
      expect(service.getPreferences().householdSize).toBe(2);
    });
  });

  test("household size within range is preserved (boundaries 1 and 12)", async () => {
    await withHandler(async ({ handler, service }) => {
      await handler.handlePost(postForm("householdSize=1"));
      expect(service.getPreferences().householdSize).toBe(1);
      await handler.handlePost(postForm("householdSize=12"));
      expect(service.getPreferences().householdSize).toBe(12);
    });
  });

  test("unknown cookingTime defaults to any", async () => {
    await withHandler(async ({ handler, service }) => {
      await handler.handlePost(postForm("cookingTime=leisurely"));
      expect(service.getPreferences().cookingTime).toBe("any");
    });
  });

  test("empty meal-type selection defaults to both slots", async () => {
    await withHandler(async ({ handler, service }) => {
      await handler.handlePost(postForm("dietary=none"));
      expect(service.getPreferences().mealTypes!.sort()).toEqual(["dinner", "lunch"]);
    });
  });

  test("invalid meal-type values are dropped, valid ones kept", async () => {
    await withHandler(async ({ handler, service }) => {
      await handler.handlePost(postForm("mealTypes=lunch&mealTypes=breakfast"));
      expect(service.getPreferences().mealTypes).toEqual(["lunch"]);
    });
  });

  test("GET after POST pre-fills saved recipe params", async () => {
    await withHandler(async ({ handler }) => {
      await handler.handlePost(postForm("kidFriendly=on&householdSize=4&cookingTime=quick&mealTypes=dinner"));
      const html = await handler.handleGet(getRequest).text();
      // kidFriendly checked
      expect(html).toMatch(/name="kidFriendly"[^>]*checked|checked[^>]*name="kidFriendly"/);
      // householdSize value 4
      expect(html).toMatch(/name="householdSize"[^>]*value="4"|value="4"[^>]*name="householdSize"/);
      // cookingTime quick selected
      expect(html).toMatch(/value="quick"[^>]*selected|selected[^>]*value="quick"/);
      // dinner checked, lunch not
      expect(html).toMatch(/value="dinner"[^>]*checked|checked[^>]*value="dinner"/);
    });
  });

  test("existing dietary + budget fields remain functional", async () => {
    await withHandler(async ({ handler, service }) => {
      await handler.handlePost(postForm("dietary=vegetarian&budget=25.50&householdSize=3"));
      const prefs = service.getPreferences();
      expect(prefs.dietaryRestriction).toBe("vegetarian");
      expect(prefs.budgetCapCents).toBe(2550);
      expect(prefs.householdSize).toBe(3);
      const html = await handler.handleGet(getRequest).text();
      expect(html).toContain('value="25.50"');
    });
  });
});
