/**
 * S01a — draft lifecycle (companion to s01a-draft-lifecycle.feature). All describe.skip (pending):
 * one scenario = one DELIVER TDD cycle. RED reason: the draft routes (POST /plan/regenerate,
 * /plan/save, /plan/discard) do not exist yet -> 404; and generate currently auto-saves, so the
 * "saved plan untouched until Save" assertion fires on missing functionality.
 *
 * Layer 4 (real HTTP + real SQLite). The keystone scenario (generate does not save) asserts a
 * positive draft observable (the "Unsaved draft" banner on GET /plan — the RED driver) and then
 * uses the Universe-bound state-delta port (Mandate 8) over the savings-tracker record count — the
 * reliable "not persisted" signal (the tracker reflects SAVED plans only, never drafts). The
 * saved-plan estimate is deliberately OUT of the universe: once GET /plan renders the draft,
 * data-estimated-savings reflects the draft, so "unchanged" would fire for the wrong reason.
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
import { FakeRecipeSource, vegRecipe } from "../../support/fake-recipe-source.ts";
import type { FetchedRecipe } from "../../../../src/recipe/ports/recipe-source.ts";

// The seeded HAPPY_VEG_BASKET includes Rote Linsen, so this key resolves a real
// candidate — every draft is non-empty and the "Unsaved draft" banner renders.
function cannedRecipeSource(): FakeRecipeSource {
  const canned = new Map<string, FetchedRecipe | null>([
    ["rote linsen", vegRecipe("Rote Linsen-Tomaten-Dal", ["200 g Rote Linsen", "2 Campari Tomaten", "Kokosmilch"], "https://example.test/dal")],
  ]);
  return new FakeRecipeSource(canned);
}

async function savingsRecordCount(port: number): Promise<number> {
  const html = await (await fetch(`http://localhost:${port}/savings`)).text();
  return (html.match(/data-saved-amount="(\d+)"/g) ?? []).length;
}

describe("@driving_port — Generating a draft does not save it; the existing saved plan is untouched", () => {
  let tmpDir: string;
  let dbPath: string;
  let serverPort: number;
  let server: { stop(): void } | null = null;

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "mpe-s01a-nosave-"));
    dbPath = join(tmpDir, "s01a.db");
    seedDiscounts(dbPath, HAPPY_VEG_BASKET);

    const { createServer } = await import("../../../../src/server.ts");
    const s = await createServer({ port: 0, dbPath, recipeSource: cannedRecipeSource() });
    server = s;
    serverPort = s.port;

    // Precondition: a plan is already saved for this week (current save path).
    await fetch(`http://localhost:${serverPort}/plan/generate`, { method: "POST" });
  });

  afterAll(() => {
    server?.stop();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("a draft is shown and the savings tracker is unchanged after generating an unsaved draft", async () => {
    const before = { "savings.recordCount": await savingsRecordCount(serverPort) };

    // Generate a new DRAFT (does not save) — the future draft route.
    await fetch(`http://localhost:${serverPort}/plan/generate?draft=true`, { method: "POST" });

    // POSITIVE observable FIRST (the RED driver): the plan view must now flag an
    // unsaved draft. Asserted before preservation so a failure is unambiguously the
    // missing banner, not the (vacuous-today) preservation half.
    const planHtml = await (await fetch(`http://localhost:${serverPort}/plan`)).text();
    expect(planHtml).toContain("Unsaved draft");

    // Preservation: the savings tracker reflects SAVED plans only — a draft writes no
    // row, so recordCount is unchanged and meaningful. (plan.savedEstimate is NOT in the
    // universe: once GET /plan renders the DRAFT, data-estimated-savings reflects the
    // draft, not the saved plan — asserting it "unchanged" would fail for the wrong reason.)
    const after = { "savings.recordCount": await savingsRecordCount(serverPort) };
    assertStateDelta(before, after, ["savings.recordCount"], {
      "savings.recordCount": unchanged(),
    });
  });
});

describe("@driving_port — Regenerate rebuilds the whole draft without persisting anything", () => {
  let tmpDir: string;
  let dbPath: string;
  let serverPort: number;
  let server: { stop(): void } | null = null;

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "mpe-s01a-regen-"));
    dbPath = join(tmpDir, "s01a.db");
    seedDiscounts(dbPath, HAPPY_VEG_BASKET);

    const { createServer } = await import("../../../../src/server.ts");
    const s = await createServer({ port: 0, dbPath, recipeSource: cannedRecipeSource() });
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

describe("@driving_port — Saving a draft persists it and offers to add its deals to the list", () => {
  let tmpDir: string;
  let dbPath: string;
  let serverPort: number;
  let server: { stop(): void } | null = null;

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "mpe-s01a-save-"));
    dbPath = join(tmpDir, "s01a.db");
    seedDiscounts(dbPath, HAPPY_VEG_BASKET);

    const { createServer } = await import("../../../../src/server.ts");
    const s = await createServer({ port: 0, dbPath, recipeSource: cannedRecipeSource() });
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

describe("@driving_port — Discarding a draft drops it and shows the last saved plan", () => {
  let tmpDir: string;
  let dbPath: string;
  let serverPort: number;
  let server: { stop(): void } | null = null;

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "mpe-s01a-discard-"));
    dbPath = join(tmpDir, "s01a.db");
    seedDiscounts(dbPath, HAPPY_VEG_BASKET);

    const { createServer } = await import("../../../../src/server.ts");
    const s = await createServer({ port: 0, dbPath, recipeSource: cannedRecipeSource() });
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

// A TWO-recipe source: both Rote Linsen and Mozzarella resolve a candidate. This is what gives
// the selection assertion teeth — a draft built from ALL items would surface BOTH recipes, so the
// absence of the un-selected one proves generateDraft honored the feed selection (D2).
function twoRecipeSource(): FakeRecipeSource {
  const canned = new Map<string, FetchedRecipe | null>([
    ["rote linsen", vegRecipe("Rote Linsen-Tomaten-Dal", ["200 g Rote Linsen", "Kokosmilch"], "https://example.test/dal")],
    ["mozzarella", vegRecipe("Mozzarella-Tomaten-Salat", ["1 Mozzarella", "2 Campari Tomaten"], "https://example.test/salat")],
  ]);
  return new FakeRecipeSource(canned);
}

describe("@driving_port — A feed-sourced draft is built from the SELECTED items only (D2)", () => {
  let tmpDir: string;
  let dbPath: string;
  let serverPort: number;
  let server: { stop(): void } | null = null;

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "mpe-s01a-selection-"));
    dbPath = join(tmpDir, "s01a.db");
    seedDiscounts(dbPath, HAPPY_VEG_BASKET);

    const { createServer } = await import("../../../../src/server.ts");
    const s = await createServer({ port: 0, dbPath, recipeSource: twoRecipeSource() });
    server = s;
    serverPort = s.port;
  });

  afterAll(() => {
    server?.stop();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("submitting a SUBSET of the feed selection builds the draft from only those products", async () => {
    // Select ONLY Rote Linsen (mpe-rote-linsen) — Mozzarella is left OUT of the selection.
    const body = new URLSearchParams();
    body.append("itemIds", "mpe-rote-linsen");
    await fetch(`http://localhost:${serverPort}/plan/generate?draft=true`, { method: "POST", body });

    const planHtml = await (await fetch(`http://localhost:${serverPort}/plan`)).text();

    // The draft is a real, non-empty draft sourced from the selection.
    expect(planHtml).toContain("Unsaved draft");
    expect(planHtml).toContain("Rote Linsen-Tomaten-Dal");
    // Teeth: Mozzarella was NOT selected, so its recipe must be absent. A draft built from ALL
    // weekly items (the pre-D2 bug) would surface it — this assertion fails RED on that path.
    expect(planHtml).not.toContain("Mozzarella-Tomaten-Salat");
  });
});
