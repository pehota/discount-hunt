/**
 * S02 — list-source (companion to s02-list-source.feature). describe.skip.
 * RED reason: no list-sourced generation route exists (D2). Generating from /list must read
 * ShoppingListService.getCurrentList() as the source; an empty list must show an explanatory state.
 * Layer 4 real HTTP + real SQLite. The shopping list is populated via the shipped POST /list/add.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { seedDiscounts } from "../../support/seed-discounts.ts";
import { ROTE_LINSEN, CAMPARI_TOMATEN, BASMATI_REIS } from "../../support/meal-plan-domain.ts";

describe.skip("@driving_port — Generating from the shopping list uses the list's items as the source", () => {
  let tmpDir: string;
  let dbPath: string;
  let serverPort: number;
  let server: { stop(): void } | null = null;

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "mpe-s02-list-"));
    dbPath = join(tmpDir, "s02.db");
    seedDiscounts(dbPath, [ROTE_LINSEN, CAMPARI_TOMATEN, BASMATI_REIS]);

    const { createServer } = await import("../../../../src/server.ts");
    const s = await createServer({ port: 0, dbPath });
    server = s;
    serverPort = s.port;

    // Put the three deals on the list via the shipped add route (the list becomes the source).
    const body = [ROTE_LINSEN, CAMPARI_TOMATEN, BASMATI_REIS].map((p) => `itemIds=${encodeURIComponent(p.id)}`).join("&");
    await fetch(`http://localhost:${serverPort}/list/add`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
    });
  });

  afterAll(() => {
    server?.stop();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("the plan generated from the list is built from the list's items", async () => {
    const gen = await fetch(`http://localhost:${serverPort}/plan/generate?from=list`, { method: "POST" });
    expect(gen.ok).toBe(true);
    const html = await (await fetch(`http://localhost:${serverPort}/plan`)).text();
    expect(html).toContain(BASMATI_REIS.name);
  });
});

describe.skip("@driving_port — Generating from an empty list is explained, not fabricated", () => {
  let tmpDir: string;
  let dbPath: string;
  let serverPort: number;
  let server: { stop(): void } | null = null;

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "mpe-s02-empty-list-"));
    dbPath = join(tmpDir, "s02.db");
    // No list items added -> empty list.

    const { createServer } = await import("../../../../src/server.ts");
    const s = await createServer({ port: 0, dbPath });
    server = s;
    serverPort = s.port;
  });

  afterAll(() => {
    server?.stop();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("generating from an empty list shows the explanatory empty state", async () => {
    const gen = await fetch(`http://localhost:${serverPort}/plan/generate?from=list`, { method: "POST" });
    const genHtml = await gen.text();
    expect(genHtml).toContain("Your list is empty — add items first");
  });
});
