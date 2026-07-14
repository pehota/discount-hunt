/**
 * PreferencesService — thin CRUD wrapper round-trip (step 03-02).
 *
 * Port-to-port at the service scope: updatePreferences then getPreferences returns
 * the persisted value, backed by the real SQLite adapter (no mocks in the hexagon).
 */

import { describe, test, expect } from "bun:test";
import fc from "fast-check";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDb } from "../shared/db.ts";
import { SQLiteUserPreferencesRepository } from "./adapters/sqlite-user-preferences-repository.ts";
import { PreferencesService } from "./preferences-service.ts";
import type { DietaryRestriction } from "../shared/types.ts";

const restrictionArb: fc.Arbitrary<DietaryRestriction> = fc.constantFrom(
  "none", "vegetarian", "vegan",
);

describe("PreferencesService", () => {
  test("getPreferences() returns the default before any update", () => {
    const dir = mkdtempSync(join(tmpdir(), "dh-prefsvc-"));
    try {
      const db = createDb(join(dir, "svc.db"));
      const service = new PreferencesService(new SQLiteUserPreferencesRepository(db));
      expect(service.getPreferences()).toEqual({ dietaryRestriction: "none" });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("updatePreferences then getPreferences round-trips any restriction", () => {
    fc.assert(
      fc.property(restrictionArb, (restriction) => {
        const dir = mkdtempSync(join(tmpdir(), "dh-prefsvc-"));
        try {
          const db = createDb(join(dir, "svc.db"));
          const service = new PreferencesService(new SQLiteUserPreferencesRepository(db));
          service.updatePreferences({ dietaryRestriction: restriction });
          expect(service.getPreferences()).toEqual({ dietaryRestriction: restriction });
        } finally {
          rmSync(dir, { recursive: true, force: true });
        }
      }),
      { numRuns: 30 },
    );
  });
});
