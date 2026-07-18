/**
 * Walking Skeleton — meal-plan-engine invariant rail (companion to walking-skeleton.feature).
 *
 * GREEN before handoff. This asserts behaviour that is shipped TODAY and that the meal-plan-engine
 * feature MUST preserve (System Constraints "No regression"): generate a plan -> plan shows a saving
 * -> savings tracker matches -> the plan's discounted products add to the shopping list via the
 * shipped POST /list/add. It exercises the shopping-list leg (the JOB-004 loop) that the shipped S01
 * walking skeleton does not — so it is not a duplicate.
 *
 * Layer 4 (real HTTP + real SQLite): traditional assertions per Mandate 8. Production composition
 * root (createServer) — Pillar 3. No new production code is required for this scenario to pass.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { seedDiscounts } from "../../support/seed-discounts.ts";
import { HAPPY_VEG_BASKET, ROTE_LINSEN, CAMPARI_TOMATEN, MOZZARELLA } from "../../support/meal-plan-domain.ts";

describe("@walking_skeleton @driving_port — Dimitar generates a plan, sees its saving, and shops from it", () => {
  let tmpDir: string;
  let dbPath: string;
  let serverPort: number;
  let server: { stop(): void } | null = null;

  beforeAll(async () => {
    // Given the application is running against a fresh database
    tmpDir = mkdtempSync(join(tmpdir(), "mpe-walking-skeleton-"));
    dbPath = join(tmpDir, "ws.db");

    // And this week's discounts include Rote Linsen, Campari Tomaten and Mozzarella
    seedDiscounts(dbPath, HAPPY_VEG_BASKET);

    const { createServer } = await import("../../../../src/server.ts");
    const s = await createServer({ port: 0, dbPath });
    server = s;
    serverPort = s.port;
  });

  afterAll(() => {
    server?.stop();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("the plan shows an estimated weekly saving and the savings tracker matches it", async () => {
    // When he generates a meal plan from this week's discounts
    const generate = await fetch(`http://localhost:${serverPort}/plan/generate`, { method: "POST" });
    expect(generate.ok).toBe(true);

    // Then the meal plan shows an estimated weekly saving
    const planHtml = await (await fetch(`http://localhost:${serverPort}/plan`)).text();
    const estMatch = planHtml.match(/data-estimated-savings="(\d+)"/);
    expect(estMatch).not.toBeNull();
    const estimatedCents = estMatch![1]!;
    expect(Number(estimatedCents)).toBeGreaterThan(0);

    // And the savings tracker shows the same saved amount as the plan estimate
    const savingsHtml = await (await fetch(`http://localhost:${serverPort}/savings`)).text();
    const savedMatch = savingsHtml.match(/data-saved-amount="(\d+)"/);
    expect(savedMatch).not.toBeNull();
    expect(savedMatch![1]).toBe(estimatedCents);
  });

  test("the plan's discounted products add to the shopping list with the running total updated", async () => {
    // When he adds the plan's discounted products to his shopping list
    const body = HAPPY_VEG_BASKET.map((p) => `itemIds=${encodeURIComponent(p.id)}`).join("&");
    const add = await fetch(`http://localhost:${serverPort}/list/add`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
    });
    expect(add.ok).toBe(true);

    // Then the shopping list contains Rote Linsen, Campari Tomaten and Mozzarella
    const listHtml = await (await fetch(`http://localhost:${serverPort}/list`)).text();
    expect(listHtml).toContain(ROTE_LINSEN.name);
    expect(listHtml).toContain(CAMPARI_TOMATEN.name);
    expect(listHtml).toContain(MOZZARELLA.name);

    // And the shopping list running total reflects those products' sale prices.
    // Total = 119 + 129 + 69 = 317 cents = €3.17. The list renders euros; assert the euro figure.
    const expectedTotalEuros = ((ROTE_LINSEN.salePriceCents + CAMPARI_TOMATEN.salePriceCents + MOZZARELLA.salePriceCents) / 100).toFixed(2);
    expect(listHtml).toContain(expectedTotalEuros);
  });
});
