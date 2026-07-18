/**
 * TECH-06 — archive expired plans (companion to tech06-archive-expired-plans.feature). describe.skip.
 * RED reason: replace-on-save deletes the prior plan with no archive; no plan-archive read surface
 * exists. Delivered inside S01 persistence. Layer 4 real HTTP + real SQLite; the archive is asserted
 * through an observable read surface (GET /plan/archive), NOT internal table inspection (Universe).
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { seedDiscounts } from "../../support/seed-discounts.ts";
import { HAPPY_VEG_BASKET } from "../../support/meal-plan-domain.ts";
import { FakeRecipeSource, vegRecipe } from "../../support/fake-recipe-source.ts";
import type { FetchedRecipe } from "../../../../src/recipe/ports/recipe-source.ts";

// The seeded HAPPY_VEG_BASKET includes Rote Linsen, so this key resolves a real
// candidate — every draft is non-empty and the saved plans are meaningful.
function cannedRecipeSource(): FakeRecipeSource {
  const canned = new Map<string, FetchedRecipe | null>([
    ["rote linsen", vegRecipe("Rote Linsen-Tomaten-Dal", ["200 g Rote Linsen", "2 Campari Tomaten", "Kokosmilch"], "https://example.test/dal")],
  ]);
  return new FakeRecipeSource(canned);
}

// 4 sequential real-HTTP round-trips over Bun.serve + SQLite in beforeAll can
// exceed bun:test's default 5000ms under full-suite parallel load — hence the
// generous per-hook / per-test timeout (test-infra robustness, not behavior).
const TECH06_TIMEOUT_MS = 20000;

describe("@driving_port — Replacing a saved plan archives the previous plan rather than deleting it", () => {
  let tmpDir: string;
  let dbPath: string;
  let serverPort: number;
  let server: { stop(): void } | null = null;

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "mpe-tech06-archive-"));
    dbPath = join(tmpDir, "tech06.db");
    seedDiscounts(dbPath, HAPPY_VEG_BASKET);

    const { createServer } = await import("../../../../src/server.ts");
    const s = await createServer({ port: 0, dbPath, recipeSource: cannedRecipeSource() });
    server = s;
    serverPort = s.port;

    // Save a plan, then save again (replace) — the first must be archived.
    await fetch(`http://localhost:${serverPort}/plan/generate?draft=true`, { method: "POST" });
    await fetch(`http://localhost:${serverPort}/plan/save`, { method: "POST" });
    await fetch(`http://localhost:${serverPort}/plan/generate?draft=true`, { method: "POST" });
    await fetch(`http://localhost:${serverPort}/plan/save`, { method: "POST" });
  }, TECH06_TIMEOUT_MS);

  afterAll(() => {
    server?.stop();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("the plan archive read surface lists a previous plan", async () => {
    const archiveHtml = await (await fetch(`http://localhost:${serverPort}/plan/archive`)).text();
    const count = (archiveHtml.match(/data-archived-plan/g) ?? []).length;
    expect(count).toBeGreaterThanOrEqual(1);
  }, TECH06_TIMEOUT_MS);
});

describe("@driving_port — Archiving a plan does not disturb the savings double-count guard", () => {
  let tmpDir: string;
  let dbPath: string;
  let serverPort: number;
  let server: { stop(): void } | null = null;

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "mpe-tech06-guard-"));
    dbPath = join(tmpDir, "tech06.db");
    seedDiscounts(dbPath, HAPPY_VEG_BASKET);

    const { createServer } = await import("../../../../src/server.ts");
    const s = await createServer({ port: 0, dbPath, recipeSource: cannedRecipeSource() });
    server = s;
    serverPort = s.port;

    await fetch(`http://localhost:${serverPort}/plan/generate?draft=true`, { method: "POST" });
    await fetch(`http://localhost:${serverPort}/plan/save`, { method: "POST" });
    await fetch(`http://localhost:${serverPort}/plan/generate?draft=true`, { method: "POST" });
    await fetch(`http://localhost:${serverPort}/plan/save`, { method: "POST" });
  }, TECH06_TIMEOUT_MS);

  afterAll(() => {
    server?.stop();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("the savings tracker still shows exactly one record for the current week after replace+archive", async () => {
    const savingsHtml = await (await fetch(`http://localhost:${serverPort}/savings`)).text();
    const records = (savingsHtml.match(/data-saved-amount="(\d+)"/g) ?? []).length;
    expect(records).toBe(1);
  }, TECH06_TIMEOUT_MS);
});
