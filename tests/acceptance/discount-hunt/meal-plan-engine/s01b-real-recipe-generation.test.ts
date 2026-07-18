/**
 * S01b — real-recipe generation (companion to s01b-real-recipe-generation.feature). describe.skip.
 * RED reason: generation still emits round-robin item-names (buildMealSlot), so no meal is a real
 * recipe title, no meal names a discounted anchor, and the DietaryVerifier reject path is unwired.
 *
 * Driven-external RecipeSource is injected via the shipped `recipeSource` createServer param
 * (ATDD policy: recipe discovery = driven-external fake). Layer 4 real HTTP + real SQLite.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { seedDiscounts } from "../../support/seed-discounts.ts";
import { HAPPY_VEG_BASKET, ROTE_LINSEN, CAMPARI_TOMATEN } from "../../support/meal-plan-domain.ts";
import { FakeRecipeSource, vegRecipe, meatLieRecipe } from "../../support/fake-recipe-source.ts";
import type { FetchedRecipe } from "../../../../src/recipe/ports/recipe-source.ts";

describe.skip("@driving_port — Each drafted meal is a real recipe naming the discounted products it uses", () => {
  let tmpDir: string;
  let dbPath: string;
  let serverPort: number;
  let server: { stop(): void } | null = null;

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "mpe-s01b-real-"));
    dbPath = join(tmpDir, "s01b.db");
    seedDiscounts(dbPath, HAPPY_VEG_BASKET);

    const canned = new Map<string, FetchedRecipe | null>([
      ["rote linsen", vegRecipe("Rote Linsen-Tomaten-Dal", ["200 g Rote Linsen", "2 Campari Tomaten", "Kokosmilch"], "https://example.test/dal")],
    ]);
    const { createServer } = await import("../../../../src/server.ts");
    const s = await createServer({ port: 0, dbPath, recipeSource: new FakeRecipeSource(canned) });
    server = s;
    serverPort = s.port;

    await fetch(`http://localhost:${serverPort}/plan/generate?draft=true`, { method: "POST" });
  });

  afterAll(() => {
    server?.stop();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("a real recipe title appears as a meal, not a raw item name", async () => {
    const html = await (await fetch(`http://localhost:${serverPort}/plan`)).text();
    expect(html).toContain("Rote Linsen-Tomaten-Dal");
  });

  test("the meal names the discounted product it uses and links to its source", async () => {
    const html = await (await fetch(`http://localhost:${serverPort}/plan`)).text();
    expect(html).toContain(ROTE_LINSEN.name);
    expect(html).toContain("https://example.test/dal");
  });
});

describe.skip("@driving_port — A recipe with a hidden meat ingredient never surfaces to a vegetarian plan", () => {
  let tmpDir: string;
  let dbPath: string;
  let serverPort: number;
  let server: { stop(): void } | null = null;

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "mpe-s01b-meat-lie-"));
    dbPath = join(tmpDir, "s01b.db");
    seedDiscounts(dbPath, HAPPY_VEG_BASKET);

    // The source would return a recipe secretly listing Schinken — the verifier must reject it.
    const canned = new Map<string, FetchedRecipe | null>([
      ["rote linsen", meatLieRecipe("Brokkoli-Nudel-Gratin", "200 g Schinken, gewürfelt", "https://example.test/lie")],
    ]);
    const { createServer } = await import("../../../../src/server.ts");
    const s = await createServer({ port: 0, dbPath, recipeSource: new FakeRecipeSource(canned) });
    server = s;
    serverPort = s.port;

    await fetch(`http://localhost:${serverPort}/settings`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "dietary=vegetarian",
    });
    await fetch(`http://localhost:${serverPort}/plan/generate?draft=true`, { method: "POST" });
  });

  afterAll(() => {
    server?.stop();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("the leaking recipe never appears in the plan", async () => {
    const html = await (await fetch(`http://localhost:${serverPort}/plan`)).text();
    expect(html).not.toContain("Brokkoli-Nudel-Gratin");
    expect(html).not.toContain("Schinken");
  });
});

describe.skip("@driving_port — When no real dietary-safe recipe can be built the draft explains itself", () => {
  let tmpDir: string;
  let dbPath: string;
  let serverPort: number;
  let server: { stop(): void } | null = null;

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "mpe-s01b-empty-"));
    dbPath = join(tmpDir, "s01b.db");
    seedDiscounts(dbPath, HAPPY_VEG_BASKET);

    // Source finds nothing usable for any query -> empty candidate set.
    const { createServer } = await import("../../../../src/server.ts");
    const s = await createServer({ port: 0, dbPath, recipeSource: new FakeRecipeSource(new Map()) });
    server = s;
    serverPort = s.port;

    await fetch(`http://localhost:${serverPort}/plan/generate?draft=true`, { method: "POST" });
  });

  afterAll(() => {
    server?.stop();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("the draft shows the no-recipe empty-with-reason message and fabricates nothing", async () => {
    const html = await (await fetch(`http://localhost:${serverPort}/plan`)).text();
    expect(html).toContain("Couldn't build meals from these — try a different selection");
    expect(html).not.toContain(CAMPARI_TOMATEN.name);
  });
});
