/**
 * RecipeService — cache-first + refresh-on-expiry (step 08-02, design §6).
 *
 * Driven by an inline FakeRecipeSource (no network, no support-file boundary crossing)
 * plus a real SQLite RecipeRepository (adapter integration, Mandate 6). The Fake carries
 * a call-counter so the cache-hit case can assert the source was NOT reached.
 *
 * The five behaviors (design §6 / §12 B1–B3, B6–B7):
 *   B1 cache-hit (fresh)            → return cached, source.find NOT called
 *   B2 miss → fetch → cache         → source.find called, row now cached, recipe returned
 *   B3 expired → re-fetch success   → refreshed content returned, cached_at advanced
 *   B7 source-null on a miss        → null (nothing found, nothing cached)
 *   B6 expired + source-null        → markSourceDead, return stale cached w/ sourceUrlValid=false
 */

import { describe, test, expect } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDb, type DbClient } from "./../shared/db.ts";
import { SQLiteRecipeRepository, type CachedRecipe } from "./adapters/sqlite-recipe-repository.ts";
import { RecipeService } from "./recipe-service.ts";
import type { FetchedRecipe, RecipeSource } from "./ports/recipe-source.ts";

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

class FakeRecipeSource implements RecipeSource {
  findCallCount = 0;
  lastQuery: string | null = null;
  constructor(private readonly result: FetchedRecipe | null) {}
  async find(query: string): Promise<FetchedRecipe | null> {
    this.findCallCount += 1;
    this.lastQuery = query;
    return this.result;
  }
}

function withDb<T>(run: (db: DbClient) => T | Promise<T>): T | Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), "dh-recipe-svc-"));
  try {
    return run(createDb(join(dir, "svc.db")));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const fetched: FetchedRecipe = {
  name: "Indische Linsensuppe",
  ingredients: ["Rote Linsen", "Zwiebel", "Kokosmilch"],
  steps: ["Zwiebel anbraten", "Linsen kochen", "Pürieren"],
  sourceUrl: "https://www.chefkoch.de/rezepte/1/linsensuppe.html",
};

describe("RecipeService", () => {
  test("B1 cache-hit (fresh) returns cached content WITHOUT calling the source", async () => {
    await withDb(async (db) => {
      const repo = new SQLiteRecipeRepository(db);
      const fresh: CachedRecipe = {
        id: "r1",
        queryKey: "rote linsen",
        name: "Cached Linsensuppe",
        ingredients: ["Linsen"],
        steps: ["Kochen"],
        sourceUrl: "https://www.chefkoch.de/rezepte/9/cached.html",
        sourceUrlValid: true,
        cachedAt: Date.now(), // fresh
      };
      repo.cache(fresh);
      const source = new FakeRecipeSource(fetched);
      const service = new RecipeService(repo, source);

      const result = await service.getRecipeForMeal("Rote Linsen");

      expect(source.findCallCount).toBe(0); // no network / no source touch on a fresh hit
      expect(result).not.toBeNull();
      expect(result!.name).toBe("Cached Linsensuppe");
      expect(result!.ingredients).toEqual(["Linsen"]);
      expect(result!.sourceUrlValid).toBe(true);
    });
  });

  test("B2 cache-miss fetches from the source, caches it, and returns the fresh recipe", async () => {
    await withDb(async (db) => {
      const repo = new SQLiteRecipeRepository(db);
      const source = new FakeRecipeSource(fetched);
      const service = new RecipeService(repo, source);

      const result = await service.getRecipeForMeal("Rote Linsen");

      expect(source.findCallCount).toBe(1);
      expect(source.lastQuery).toBe("rote linsen"); // normalized query key
      expect(result!.name).toBe(fetched.name);
      expect(result!.ingredients).toEqual(fetched.ingredients);
      expect(result!.steps).toEqual(fetched.steps);
      expect(result!.sourceUrl).toBe(fetched.sourceUrl);
      expect(result!.sourceUrlValid).toBe(true);
      // A row now exists for the query.
      const cached = repo.getByQuery("rote linsen");
      expect(cached).not.toBeNull();
      expect(cached!.name).toBe(fetched.name);
    });
  });

  test("B3 expired cache re-fetches and returns refreshed content with advanced cached_at", async () => {
    await withDb(async (db) => {
      const repo = new SQLiteRecipeRepository(db);
      const stale: CachedRecipe = {
        id: "r2",
        queryKey: "rote linsen",
        name: "Old Name",
        ingredients: ["Old"],
        steps: ["Old step"],
        sourceUrl: "https://www.chefkoch.de/rezepte/0/old.html",
        sourceUrlValid: true,
        cachedAt: Date.now() - SEVEN_DAYS_MS - 1000, // expired
      };
      repo.cache(stale);
      const source = new FakeRecipeSource(fetched);
      const service = new RecipeService(repo, source);

      const result = await service.getRecipeForMeal("Rote Linsen");

      expect(source.findCallCount).toBe(1); // expiry triggers a re-fetch
      expect(result!.name).toBe(fetched.name); // refreshed
      const cached = repo.getByQuery("rote linsen");
      expect(cached!.name).toBe(fetched.name);
      expect(cached!.cachedAt).toBeGreaterThan(stale.cachedAt);
    });
  });

  test("B7 source returns null on a miss → getRecipeForMeal returns null (nothing cached)", async () => {
    await withDb(async (db) => {
      const repo = new SQLiteRecipeRepository(db);
      const source = new FakeRecipeSource(null);
      const service = new RecipeService(repo, source);

      const result = await service.getRecipeForMeal("Unbekanntes Gericht");

      expect(source.findCallCount).toBe(1);
      expect(result).toBeNull();
      expect(repo.getByQuery("unbekanntes gericht")).toBeNull();
    });
  });

  test("B6 expired cache + source null → marks source dead and returns the stale copy with sourceUrlValid=false", async () => {
    await withDb(async (db) => {
      const repo = new SQLiteRecipeRepository(db);
      const stale: CachedRecipe = {
        id: "r3",
        queryKey: "zucchini",
        name: "Zucchinicremesuppe",
        ingredients: ["Zucchini", "Sahne"],
        steps: ["Anbraten", "Pürieren"],
        sourceUrl: "https://www.chefkoch.de/rezepte/2/z.html",
        sourceUrlValid: true,
        cachedAt: Date.now() - SEVEN_DAYS_MS - 1000, // expired
      };
      repo.cache(stale);
      const source = new FakeRecipeSource(null); // source now unreachable / no result
      const service = new RecipeService(repo, source);

      const result = await service.getRecipeForMeal("Zucchini");

      expect(source.findCallCount).toBe(1);
      expect(result).not.toBeNull();
      // Stale content returned, flag flipped to false (fallback a).
      expect(result!.name).toBe(stale.name);
      expect(result!.ingredients).toEqual(stale.ingredients);
      expect(result!.steps).toEqual(stale.steps);
      expect(result!.sourceUrlValid).toBe(false);
      // Persisted: source_url_valid=0, cached_content preserved.
      const persisted = repo.getByQuery("zucchini");
      expect(persisted!.sourceUrlValid).toBe(false);
      expect(persisted!.ingredients).toEqual(stale.ingredients);
    });
  });
});
