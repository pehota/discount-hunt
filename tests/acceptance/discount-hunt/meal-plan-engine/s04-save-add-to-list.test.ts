/**
 * S04 — save->list prompt (companion to s04-save-add-to-list.feature). describe.skip.
 * RED reason: saving a plan does not emit the add-to-list prompt nor add the plan's deals; the
 * accept/decline branch does not exist. Accept must route through the shipped POST /list/add
 * (dedup already handled). Layer 4 real HTTP + real SQLite.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { seedDiscounts } from "../../support/seed-discounts.ts";
import { HAPPY_VEG_BASKET, ROTE_LINSEN, CAMPARI_TOMATEN, MOZZARELLA } from "../../support/meal-plan-domain.ts";

describe.skip("@driving_port — Accepting the prompt adds the plan's deals to the shopping list", () => {
  let tmpDir: string;
  let dbPath: string;
  let serverPort: number;
  let server: { stop(): void } | null = null;

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "mpe-s04-accept-"));
    dbPath = join(tmpDir, "s04.db");
    seedDiscounts(dbPath, HAPPY_VEG_BASKET);

    const { createServer } = await import("../../../../src/server.ts");
    const s = await createServer({ port: 0, dbPath });
    server = s;
    serverPort = s.port;

    await fetch(`http://localhost:${serverPort}/plan/generate?draft=true`, { method: "POST" });
    await fetch(`http://localhost:${serverPort}/plan/save`, { method: "POST" });
  });

  afterAll(() => {
    server?.stop();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("accepting the prompt places the plan's three products on the list", async () => {
    const accept = await fetch(`http://localhost:${serverPort}/plan/add-to-list`, { method: "POST" });
    expect(accept.ok).toBe(true);
    const listHtml = await (await fetch(`http://localhost:${serverPort}/list`)).text();
    expect(listHtml).toContain(ROTE_LINSEN.name);
    expect(listHtml).toContain(CAMPARI_TOMATEN.name);
    expect(listHtml).toContain(MOZZARELLA.name);
  });
});

describe.skip("@driving_port — Declining the prompt saves the plan and leaves the list unchanged", () => {
  let tmpDir: string;
  let dbPath: string;
  let serverPort: number;
  let server: { stop(): void } | null = null;

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "mpe-s04-decline-"));
    dbPath = join(tmpDir, "s04.db");
    seedDiscounts(dbPath, HAPPY_VEG_BASKET);

    const { createServer } = await import("../../../../src/server.ts");
    const s = await createServer({ port: 0, dbPath });
    server = s;
    serverPort = s.port;

    await fetch(`http://localhost:${serverPort}/plan/generate?draft=true`, { method: "POST" });
    await fetch(`http://localhost:${serverPort}/plan/save`, { method: "POST" });
  });

  afterAll(() => {
    server?.stop();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("declining leaves the shopping list empty", async () => {
    // Decline is the default no-op; the plan stays saved, the list is untouched.
    const listHtml = await (await fetch(`http://localhost:${serverPort}/list`)).text();
    expect(listHtml).not.toContain(ROTE_LINSEN.name);
  });
});

describe.skip("@driving_port — A product already on the list is not duplicated when the prompt is accepted", () => {
  let tmpDir: string;
  let dbPath: string;
  let serverPort: number;
  let server: { stop(): void } | null = null;

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "mpe-s04-dedup-"));
    dbPath = join(tmpDir, "s04.db");
    seedDiscounts(dbPath, HAPPY_VEG_BASKET);

    const { createServer } = await import("../../../../src/server.ts");
    const s = await createServer({ port: 0, dbPath });
    server = s;
    serverPort = s.port;

    // Campari Tomaten already on the list.
    await fetch(`http://localhost:${serverPort}/list/add`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: `itemIds=${encodeURIComponent(CAMPARI_TOMATEN.id)}`,
    });
    await fetch(`http://localhost:${serverPort}/plan/generate?draft=true`, { method: "POST" });
    await fetch(`http://localhost:${serverPort}/plan/save`, { method: "POST" });
  });

  afterAll(() => {
    server?.stop();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("Campari Tomaten appears only once on the list after accepting", async () => {
    await fetch(`http://localhost:${serverPort}/plan/add-to-list`, { method: "POST" });
    const listHtml = await (await fetch(`http://localhost:${serverPort}/list`)).text();
    const occurrences = (listHtml.match(new RegExp(`list-item-name">${CAMPARI_TOMATEN.name}`, "g")) ?? []).length;
    expect(occurrences).toBe(1);
  });
});
