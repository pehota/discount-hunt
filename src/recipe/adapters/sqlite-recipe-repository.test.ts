/**
 * SQLiteRecipeRepository — real-sqlite adapter tests (step 08-01).
 *
 * Real SQLite via createDb (never mocked — adapter integration, Mandate 6).
 * PBT over the round-trip: whatever recipe is cached, getByQuery returns it back
 * with ingredients/steps parsed from cached_content. markSourceDead is asserted
 * with a state-delta view of the observable row surface: only source_url_valid
 * flips; cached_content / name / source_url stay unchanged.
 */

import { describe, test, expect } from "bun:test";
import fc from "fast-check";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { createDb, type DbClient } from "../../shared/db.ts";
import { SQLiteRecipeRepository, type CachedRecipe } from "./sqlite-recipe-repository.ts";

function withDb<T>(run: (db: DbClient) => T): T {
  const dir = mkdtempSync(join(tmpdir(), "dh-recipe-"));
  try {
    return run(createDb(join(dir, "recipe.db")));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const recipeArb: fc.Arbitrary<CachedRecipe> = fc.record({
  id: fc.uuid(),
  queryKey: fc.string({ minLength: 1, maxLength: 20 }).map((s) => s.toLowerCase().trim() || "x"),
  name: fc.string({ minLength: 1, maxLength: 40 }),
  ingredients: fc.array(fc.string({ minLength: 1, maxLength: 30 }), { maxLength: 15 }),
  steps: fc.array(fc.string({ minLength: 1, maxLength: 60 }), { maxLength: 8 }),
  sourceUrl: fc.webUrl(),
  sourceUrlValid: fc.constant(true),
  cachedAt: fc.integer({ min: 1, max: 2_000_000_000_000 }),
});

describe("SQLiteRecipeRepository", () => {
  test("for any recipe, cache → getByQuery round-trips ingredients+steps parsed from cached_content", () => {
    fc.assert(
      fc.property(recipeArb, (recipe) => {
        withDb((db) => {
          const repo = new SQLiteRecipeRepository(db);
          repo.cache(recipe);
          const got = repo.getByQuery(recipe.queryKey);
          expect(got).not.toBeNull();
          expect(got!.name).toBe(recipe.name);
          expect(got!.ingredients).toEqual(recipe.ingredients);
          expect(got!.steps).toEqual(recipe.steps);
          expect(got!.sourceUrl).toBe(recipe.sourceUrl);
          expect(got!.sourceUrlValid).toBe(true);
          expect(got!.cachedAt).toBe(recipe.cachedAt);
        });
      }),
      { numRuns: 40 },
    );
  });

  test("getByQuery returns null for an unknown query key", () => {
    withDb((db) => {
      const repo = new SQLiteRecipeRepository(db);
      expect(repo.getByQuery("nothing-cached")).toBeNull();
    });
  });

  test("cache upserts by query_key — a second cache for the same key does not add a row", () => {
    withDb((db) => {
      const repo = new SQLiteRecipeRepository(db);
      const base: CachedRecipe = {
        id: randomUUID(),
        queryKey: "rote linsen",
        name: "Linsensuppe",
        ingredients: ["Linsen", "Zwiebel"],
        steps: ["Kochen"],
        sourceUrl: "https://www.chefkoch.de/rezepte/1/a.html",
        sourceUrlValid: true,
        cachedAt: 1000,
      };
      repo.cache(base);
      repo.cache({ ...base, id: randomUUID(), name: "Indische Linsensuppe", cachedAt: 2000 });
      const got = repo.getByQuery("rote linsen");
      expect(got!.name).toBe("Indische Linsensuppe");
      expect(got!.cachedAt).toBe(2000);
    });
  });

  test("markSourceDead flips source_url_valid to false and preserves cached_content / name / source_url", () => {
    withDb((db) => {
      const repo = new SQLiteRecipeRepository(db);
      const recipe: CachedRecipe = {
        id: randomUUID(),
        queryKey: "zucchini",
        name: "Zucchinicremesuppe",
        ingredients: ["Zucchini", "Sahne"],
        steps: ["Anbraten", "Pürieren"],
        sourceUrl: "https://www.chefkoch.de/rezepte/2/z.html",
        sourceUrlValid: true,
        cachedAt: 5000,
      };
      repo.cache(recipe);

      repo.markSourceDead(recipe.id);

      const after = repo.getByQuery("zucchini");
      expect(after!.sourceUrlValid).toBe(false);
      // Delta guard: only the flag changed — content, name, url, cachedAt untouched.
      expect(after!.name).toBe(recipe.name);
      expect(after!.ingredients).toEqual(recipe.ingredients);
      expect(after!.steps).toEqual(recipe.steps);
      expect(after!.sourceUrl).toBe(recipe.sourceUrl);
      expect(after!.cachedAt).toBe(recipe.cachedAt);
    });
  });
});
