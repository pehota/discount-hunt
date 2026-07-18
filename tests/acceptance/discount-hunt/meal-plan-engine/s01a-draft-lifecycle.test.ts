/**
 * S01a — draft lifecycle (companion to s01a-draft-lifecycle.feature). All describe.skip (pending):
 * one scenario = one DELIVER TDD cycle. RED reason: the draft routes (POST /plan/regenerate,
 * /plan/save, /plan/discard) do not exist yet -> 404; and generate currently auto-saves, so the
 * "saved plan untouched until Save" assertion fires on missing functionality.
 *
 * Layer 4 (real HTTP + real SQLite). The keystone scenario (generate does not save) uses the
 * Universe-bound state-delta port (Mandate 8) over the port-exposed observables (saved-plan
 * estimate + savings-tracker record count) — the seam this port earns its keep on.
 *
 * Setup fetches carry NO expect() (an unbuilt route 404s as a Response, it does not throw) so a
 * missing route never BREAKS the describe; every expect() lives in a test body -> failures are RED.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { seedDiscounts } from "../../support/seed-discounts.ts";
import { HAPPY_VEG_BASKET } from "../../support/meal-plan-domain.ts";
import { assertStateDelta, setTo, unchanged } from "../../../common/state_delta.ts";

async function planSavedEstimate(port: number): Promise<string | null> {
  const html = await (await fetch(`http://localhost:${port}/plan`)).text();
  return html.match(/data-estimated-savings="(\d+)"/)?.[1] ?? null;
}

async function savingsRecordCount(port: number): Promise<number> {
  const html = await (await fetch(`http://localhost:${port}/savings`)).text();
  return (html.match(/data-saved-amount="(\d+)"/g) ?? []).length;
}

describe.skip("@driving_port — Generating a draft does not save it; the existing saved plan is untouched", () => {
  let tmpDir: string;
  let dbPath: string;
  let serverPort: number;
  let server: { stop(): void } | null = null;

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "mpe-s01a-nosave-"));
    dbPath = join(tmpDir, "s01a.db");
    seedDiscounts(dbPath, HAPPY_VEG_BASKET);

    const { createServer } = await import("../../../../src/server.ts");
    const s = await createServer({ port: 0, dbPath });
    server = s;
    serverPort = s.port;

    // Precondition: a plan is already saved for this week (current save path).
    await fetch(`http://localhost:${serverPort}/plan/generate`, { method: "POST" });
  });

  afterAll(() => {
    server?.stop();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("the saved plan and the savings tracker are unchanged after generating an unsaved draft", async () => {
    const before = {
      "plan.savedEstimate": await planSavedEstimate(serverPort),
      "savings.recordCount": await savingsRecordCount(serverPort),
    };

    // Generate a new DRAFT (does not save) — the future draft route.
    await fetch(`http://localhost:${serverPort}/plan/generate?draft=true`, { method: "POST" });

    const after = {
      "plan.savedEstimate": await planSavedEstimate(serverPort),
      "savings.recordCount": await savingsRecordCount(serverPort),
    };

    // Universe = port-exposed observables only. Both must be unchanged (fail-closed).
    assertStateDelta(before, after, ["plan.savedEstimate", "savings.recordCount"], {
      "plan.savedEstimate": unchanged(),
      "savings.recordCount": unchanged(),
    });
  });
});

describe.skip("@driving_port — Regenerate rebuilds the whole draft without persisting anything", () => {
  let tmpDir: string;
  let dbPath: string;
  let serverPort: number;
  let server: { stop(): void } | null = null;

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "mpe-s01a-regen-"));
    dbPath = join(tmpDir, "s01a.db");
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

  test("regenerate returns a draft and persists nothing to the savings tracker", async () => {
    const before = { "savings.recordCount": await savingsRecordCount(serverPort) };
    const regen = await fetch(`http://localhost:${serverPort}/plan/regenerate`, { method: "POST" });
    expect(regen.ok).toBe(true);
    const after = { "savings.recordCount": await savingsRecordCount(serverPort) };
    assertStateDelta(before, after, ["savings.recordCount"], { "savings.recordCount": unchanged() });
  });
});

describe.skip("@driving_port — Saving a draft persists it and offers to add its deals to the list", () => {
  let tmpDir: string;
  let dbPath: string;
  let serverPort: number;
  let server: { stop(): void } | null = null;

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "mpe-s01a-save-"));
    dbPath = join(tmpDir, "s01a.db");
    seedDiscounts(dbPath, HAPPY_VEG_BASKET);

    const { createServer } = await import("../../../../src/server.ts");
    const s = await createServer({ port: 0, dbPath });
    server = s;
    serverPort = s.port;

    await fetch(`http://localhost:${serverPort}/plan/generate?draft=true`, { method: "POST" });
  });

  afterAll(() => {
    server?.stop();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("saving the draft records a savings row and returns the add-to-list prompt", async () => {
    const before = { "savings.recordCount": await savingsRecordCount(serverPort) };
    const save = await fetch(`http://localhost:${serverPort}/plan/save`, { method: "POST" });
    expect(save.ok).toBe(true);
    const saveHtml = await save.text();
    expect(saveHtml).toContain("Add this plan's discounted items to your shopping list");

    const after = { "savings.recordCount": await savingsRecordCount(serverPort) };
    assertStateDelta(before, after, ["savings.recordCount"], {
      "savings.recordCount": setTo(before["savings.recordCount"] + 1),
    });
  });
});

describe.skip("@driving_port — Discarding a draft drops it and shows the last saved plan", () => {
  let tmpDir: string;
  let dbPath: string;
  let serverPort: number;
  let server: { stop(): void } | null = null;

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "mpe-s01a-discard-"));
    dbPath = join(tmpDir, "s01a.db");
    seedDiscounts(dbPath, HAPPY_VEG_BASKET);

    const { createServer } = await import("../../../../src/server.ts");
    const s = await createServer({ port: 0, dbPath });
    server = s;
    serverPort = s.port;

    // A saved plan exists; then a newer unsaved draft.
    await fetch(`http://localhost:${serverPort}/plan/save`, { method: "POST" });
    await fetch(`http://localhost:${serverPort}/plan/generate?draft=true`, { method: "POST" });
  });

  afterAll(() => {
    server?.stop();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("after discard, the plan view is shown without the draft banner", async () => {
    const discard = await fetch(`http://localhost:${serverPort}/plan/discard`, { method: "POST" });
    expect(discard.ok).toBe(true);
    const planHtml = await (await fetch(`http://localhost:${serverPort}/plan`)).text();
    expect(planHtml).not.toContain("Unsaved draft");
  });
});
