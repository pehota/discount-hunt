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

describe.skip("@driving_port — Replacing a saved plan archives the previous plan rather than deleting it", () => {
  let tmpDir: string;
  let dbPath: string;
  let serverPort: number;
  let server: { stop(): void } | null = null;

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "mpe-tech06-archive-"));
    dbPath = join(tmpDir, "tech06.db");
    seedDiscounts(dbPath, HAPPY_VEG_BASKET);

    const { createServer } = await import("../../../../src/server.ts");
    const s = await createServer({ port: 0, dbPath });
    server = s;
    serverPort = s.port;

    // Save a plan, then save again (replace) — the first must be archived.
    await fetch(`http://localhost:${serverPort}/plan/generate?draft=true`, { method: "POST" });
    await fetch(`http://localhost:${serverPort}/plan/save`, { method: "POST" });
    await fetch(`http://localhost:${serverPort}/plan/generate?draft=true`, { method: "POST" });
    await fetch(`http://localhost:${serverPort}/plan/save`, { method: "POST" });
  });

  afterAll(() => {
    server?.stop();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("the plan archive read surface lists a previous plan", async () => {
    const archiveHtml = await (await fetch(`http://localhost:${serverPort}/plan/archive`)).text();
    const count = (archiveHtml.match(/data-archived-plan/g) ?? []).length;
    expect(count).toBeGreaterThanOrEqual(1);
  });
});

describe.skip("@driving_port — Archiving a plan does not disturb the savings double-count guard", () => {
  let tmpDir: string;
  let dbPath: string;
  let serverPort: number;
  let server: { stop(): void } | null = null;

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "mpe-tech06-guard-"));
    dbPath = join(tmpDir, "tech06.db");
    seedDiscounts(dbPath, HAPPY_VEG_BASKET);

    const { createServer } = await import("../../../../src/server.ts");
    const s = await createServer({ port: 0, dbPath });
    server = s;
    serverPort = s.port;

    await fetch(`http://localhost:${serverPort}/plan/generate?draft=true`, { method: "POST" });
    await fetch(`http://localhost:${serverPort}/plan/save`, { method: "POST" });
    await fetch(`http://localhost:${serverPort}/plan/generate?draft=true`, { method: "POST" });
    await fetch(`http://localhost:${serverPort}/plan/save`, { method: "POST" });
  });

  afterAll(() => {
    server?.stop();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("the savings tracker still shows exactly one record for the current week after replace+archive", async () => {
    const savingsHtml = await (await fetch(`http://localhost:${serverPort}/savings`)).text();
    const records = (savingsHtml.match(/data-saved-amount="(\d+)"/g) ?? []).length;
    expect(records).toBe(1);
  });
});
