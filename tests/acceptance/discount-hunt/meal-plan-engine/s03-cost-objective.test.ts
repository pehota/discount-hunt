/**
 * S03 — cost objective (companion to s03-cost-objective.feature). describe.skip.
 * RED reason: generation has no cost objective (round-robin), no deduped multi-product savings,
 * no all-regular baseline footer. The deduped==tracker invariant + spend<=baseline are pinned at
 * the pure layer by cost-objective.test.ts (fast-check); these HTTP scenarios prove the wired
 * observable outcome. Layer 4 real HTTP + real SQLite; @kpi scenarios link KPI-1/2/3.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { seedDiscounts } from "../../support/seed-discounts.ts";
import { HAPPY_VEG_BASKET, ROTE_LINSEN, CAMPARI_TOMATEN, MOZZARELLA, BASMATI_REIS } from "../../support/meal-plan-domain.ts";
import { FakeRecipeSource, vegRecipe } from "../../support/fake-recipe-source.ts";

function cannedDal() {
  return new FakeRecipeSource(
    new Map([
      [
        "rote linsen",
        vegRecipe(
          "Rote Linsen-Tomaten-Dal",
          ["200 g Rote Linsen", "2 Campari Tomaten", "Kokosmilch"],
          "https://example.test/dal",
        ),
      ],
    ]),
  );
}

describe("@driving_port — The plan does not over-buy deals to inflate the discount count", () => {
  let tmpDir: string;
  let dbPath: string;
  let serverPort: number;
  let server: { stop(): void } | null = null;

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "mpe-s03-noverbuy-"));
    dbPath = join(tmpDir, "s03.db");
    // More products than the meals need.
    seedDiscounts(dbPath, [ROTE_LINSEN, CAMPARI_TOMATEN, MOZZARELLA, BASMATI_REIS]);

    const { createServer } = await import("../../../../src/server.ts");
    const s = await createServer({ port: 0, dbPath, recipeSource: cannedDal() });
    server = s;
    serverPort = s.port;

    await fetch(`http://localhost:${serverPort}/plan/generate?draft=true`, { method: "POST" });
  });

  afterAll(() => {
    server?.stop();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("the plan footer reports fewer used products than the surplus selected", async () => {
    const html = await (await fetch(`http://localhost:${serverPort}/plan`)).text();
    const usedMatch = html.match(/data-used-products="(\d+)"/);
    const selectedMatch = html.match(/data-selected-products="(\d+)"/);
    expect(usedMatch).not.toBeNull();
    expect(selectedMatch).not.toBeNull();
    expect(Number(usedMatch![1])).toBeLessThanOrEqual(Number(selectedMatch![1]));
  });
});

describe("@driving_port @kpi — Spend and savings count a shared product only once and match the tracker", () => {
  let tmpDir: string;
  let dbPath: string;
  let serverPort: number;
  let server: { stop(): void } | null = null;

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "mpe-s03-dedup-"));
    dbPath = join(tmpDir, "s03.db");
    seedDiscounts(dbPath, HAPPY_VEG_BASKET);

    const { createServer } = await import("../../../../src/server.ts");
    const s = await createServer({ port: 0, dbPath, recipeSource: cannedDal() });
    server = s;
    serverPort = s.port;

    await fetch(`http://localhost:${serverPort}/plan/generate?draft=true`, { method: "POST" });
    await fetch(`http://localhost:${serverPort}/plan/save`, { method: "POST" });
  });

  afterAll(() => {
    server?.stop();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("the plan's saving equals the savings tracker figure (deduped == shipped tracker)", async () => {
    const planHtml = await (await fetch(`http://localhost:${serverPort}/plan`)).text();
    const savingsHtml = await (await fetch(`http://localhost:${serverPort}/savings`)).text();
    const planSaving = planHtml.match(/data-estimated-savings="(\d+)"/)?.[1] ?? null;
    const trackerSaving = savingsHtml.match(/data-saved-amount="(\d+)"/)?.[1] ?? null;
    expect(planSaving).not.toBeNull();
    expect(trackerSaving).toBe(planSaving);
  });
});

describe("@driving_port @kpi — The plan footer shows spend against an all-regular-price baseline", () => {
  let tmpDir: string;
  let dbPath: string;
  let serverPort: number;
  let server: { stop(): void } | null = null;

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "mpe-s03-baseline-"));
    dbPath = join(tmpDir, "s03.db");
    seedDiscounts(dbPath, HAPPY_VEG_BASKET);

    const { createServer } = await import("../../../../src/server.ts");
    const s = await createServer({ port: 0, dbPath, recipeSource: cannedDal() });
    server = s;
    serverPort = s.port;

    await fetch(`http://localhost:${serverPort}/plan/generate?draft=true`, { method: "POST" });
  });

  afterAll(() => {
    server?.stop();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("the plan renders total spend and the all-regular baseline, spend <= baseline", async () => {
    const html = await (await fetch(`http://localhost:${serverPort}/plan`)).text();
    const spend = html.match(/data-plan-spend="(\d+)"/)?.[1] ?? null;
    const baseline = html.match(/data-regular-baseline="(\d+)"/)?.[1] ?? null;
    expect(spend).not.toBeNull();
    expect(baseline).not.toBeNull();
    expect(Number(spend)).toBeLessThanOrEqual(Number(baseline));
  });
});
