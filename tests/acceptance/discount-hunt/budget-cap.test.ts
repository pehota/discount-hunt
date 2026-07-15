/**
 * Acceptance Tests — SLICE-03 increment 1.5: Budget Cap (WARN + SNAPSHOT, NO regenerate)
 *
 * Source of truth: docs/feature/discount-hunt/design-preferences-model.md
 *   §2.2 (budget = WARN not trim), §5 (snapshot semantics), §6 (observable-output table),
 *   §7 increment 1.5 (prerequisites). Design locked to: warn + snapshot, NO regenerate endpoint.
 * Wave: DISTILL. Authored against the DESIGNED behavior, not current code.
 *
 * These tests are INTENTIONALLY RED until DELIVER lands:
 *   - a budget field (name="budget", euros) on GET/POST /settings (settings-handler.ts)
 *   - user_settings.budget_cap_cents (nullable INTEGER; NULL = no cap) + UserPreferences.budgetCapCents
 *   - meal_plans.budget_cap_cents snapshot column (nullable) + MealPlan.budgetCapCents
 *   - plan-service snapshots the active cap onto the plan at generation (mirrors dietaryFilter)
 *   - plan-handler renders an over-budget banner when the plan's SNAPSHOTTED cap is set
 *     AND plan.totalSalePrice > plan.budgetCapCents
 *   - invalid budget input (non-numeric, negative) treated as NO cap (NULL), never persisted
 *
 * Infrastructure (mirrors dietary-preferences.test.ts — the real repo idiom):
 *   - Real SQLite DB (temp file) via createDb
 *   - Real HTTP server (createServer) — production composition root
 *   - fetch() against a unique per-describe port; assertions on rendered HTML
 *   - The budget cap precondition is set ONLY through POST /settings (the driving port),
 *     NEVER by seeding a budget_cap_cents column — that column does not exist yet.
 *
 * SNAPSHOT-ISOLATION discipline (advisor guidance):
 *   getOrGenerateCurrentWeekPlan is idempotent — the FIRST generate for the current week
 *   freezes the plan (plan-service.ts:110-111). Every cap-effect scenario therefore uses its
 *   OWN fresh db+server so the cap under test is the cap snapshotted at that scenario's generate.
 *   Scenario 5 is the deliberate exception: one db, generate once at a LOW cap, then RAISE the cap,
 *   and observe the FROZEN plan still warns.
 *
 * RED discipline (mirrors the dietary file):
 *   - beforeAll performs setup fetches WITHOUT expect() — a POST to the unbuilt budget field
 *     resolves as a normal Response (dietary handler ignores unknown fields), never throws.
 *   - Every expect() lives in a test body → failures are RED (MISSING_FUNCTIONALITY), not BROKEN.
 *   - The over-budget MARKER is the attribute `data-over-budget` (mirrors data-estimated-savings),
 *     rendered in the populated-plan branch iff snapshotted cap set AND totalSalePrice > cap.
 *   - The budget INPUT contract is name="budget", value in EUROS (stored as cents).
 *   - Honest RED/GREEN: presence-assertions (budget field, banner-appears) are RED now;
 *     banner-ABSENCE halves are baseline-green honesty anchors that gain teeth post-impl
 *     (they kill an always-on-banner mutant). Settings-side positive assertions in the
 *     under/no-cap/invalid scenarios ARE red now, keeping every scenario falsifiable.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { createDb } from "../../../src/shared/db.ts";
import { scrapeJobs, discountItems } from "../../../src/shared/schema.ts";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

// ─── Domain vocabulary + deterministic pricing ───────────────────────────────

const STORE = "Aldi Süd";

// Two vegan items at 99c sale each → totalSalePrice = 198c = €1.98 (generatePlan sums
// ALL weekly items' salePrice, plan-service.ts:47, independent of meal-slot assignment).
//   → a €1.00 (100c) cap IS exceeded  → over-budget banner expected
//   → a €9999 cap is NOT exceeded     → no banner
const ITEM_A = "Haferflocken";   // 99c
const ITEM_B = "Sojadrink";      // 99c
const ITEM_SALE_CENTS = 99;
const PLAN_SALE_TOTAL_CENTS = ITEM_SALE_CENTS * 2; // 198c = €1.98

// The single, stable over-budget MARKER the crafter must render (see header + OUTPUT note).
const OVER_BUDGET_MARKER = "data-over-budget";

/** ISO date N days from now (validUntil must be >= current Monday to pass getByWeek filter). */
function daysFromNow(n: number): string {
  return new Date(Date.now() + n * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/**
 * Seeds a scrape_jobs row plus two vegan items at 99c each so the plan's totalSalePrice
 * is a deterministic 198c (€1.98). Items are vegan-tagged so no dietary filter removes them
 * (dietary is pinned to "none" in every POST here anyway). Mirrors multi-store.test.ts seeding.
 */
function seedTwoNinetyNineCentItems(dbPath: string): void {
  const db = createDb(dbPath);
  const now = Date.now();
  const jobId = randomUUID();
  const validUntil = daysFromNow(7);

  db.insert(scrapeJobs).values({
    id: jobId,
    store: STORE,
    status: "completed",
    startedAt: now - 3600 * 1000,
    completedAt: now - 1800 * 1000,
    itemCount: 2,
  }).run();

  const rows = [
    { id: "budget-a-001", name: ITEM_A },
    { id: "budget-b-001", name: ITEM_B },
  ];

  for (const r of rows) {
    db.insert(discountItems).values({
      id: r.id,
      store: STORE,
      name: r.name,
      category: "food",
      regularPrice: 199,
      salePrice: ITEM_SALE_CENTS,
      validUntil,
      dietaryTags: JSON.stringify(["vegan"]),
      scrapeJobId: jobId,
      createdAt: now,
    }).run();
  }
}

/**
 * POST /settings carrying a budget cap in EUROS — the driving port that sets the cap.
 * dietary is pinned to "none" so no dietary filter perturbs the seed (keeps this file's
 * observable purely budget-driven). Pass `null` to POST an empty budget (clears the cap).
 */
async function saveBudgetCap(port: number, euros: number | string | null): Promise<Response> {
  const body = new URLSearchParams({
    dietary: "none",
    budget: euros === null ? "" : String(euros),
  });
  return fetch(`http://localhost:${port}/settings`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: body.toString(),
    redirect: "manual",
  });
}

/**
 * POST /plan/generate — freezes the current-week plan (snapshots the active cap).
 * Submits the feed's CHECKED selection (post-SLICE contract: Generate builds from
 * EXACTLY the submitted items); extracts checked itemIds from GET / to faithfully
 * simulate the browser (the feed is restriction-filtered).
 */
async function generatePlan(port: number): Promise<Response> {
  const html = await (await fetch(`http://localhost:${port}/`)).text();
  const ids: string[] = [];
  const re = /<input type="checkbox"[^>]*name="itemIds"[^>]*value="([^"]*)"[^>]*checked/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) ids.push(m[1]!);
  return fetch(`http://localhost:${port}/plan/generate`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: ids.map((id) => `itemIds=${encodeURIComponent(id)}`).join("&"),
    redirect: "manual",
  });
}

// ─── Scenario 1: Settings page exposes a budget field that round-trips ─────────
// §6 "Budget cap" row (settings-side) + §7 increment 1.5 "settings-page control".
// RED reason: settings-handler renders only the dietary <select>; there is no budget input
// and no persisted budget_cap_cents, so neither the field nor the saved value appears.

describe("@driving_port — Settings page exposes a weekly budget field that persists", () => {
  let tmpDir: string;
  let dbPath: string;
  let serverPort: number;
  let server: { stop(): void } | null = null;

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "discount-hunt-budget-settings-"));
    dbPath = join(tmpDir, "budget-settings.db");
    seedTwoNinetyNineCentItems(dbPath);

    const { createServer } = await import("../../../src/server.ts");
    const s = await createServer({ port: 0, dbPath });
    server = s;
    serverPort = s.port;

    // Precondition: a cap was previously saved through the driving port (no DB seed).
    // No expect() here — a handler that ignores the unknown "budget" field just re-renders.
    await saveBudgetCap(serverPort, 25);
  });

  afterAll(() => {
    server?.stop();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("GET /settings returns HTML with a budget input field", async () => {
    const response = await fetch(`http://localhost:${serverPort}/settings`);
    expect(response.ok).toBe(true);
    const html = await response.text();
    // An <input name="budget"> (euros). Match any attribute order so a correct impl is never false-RED.
    expect(html).toMatch(/<input\b[^>]*name="budget"/);
  });

  test("after saving €25, GET /settings shows the saved cap value", async () => {
    const response = await fetch(`http://localhost:${serverPort}/settings`);
    expect(response.ok).toBe(true);
    const html = await response.text();
    // The budget input carries the just-saved euros value.
    const budgetInput = html.match(/<input\b[^>]*name="budget"[^>]*>/)?.[0] ?? "";
    expect(budgetInput).toMatch(/value="25(\.00)?"/);
  });
});

// ─── Scenario 2: Over-budget banner appears when plan total exceeds a low cap ──
// §2.2 (warn effect) + §6 "Budget cap" row (banner half).
// LOW cap €1.00 (100c) < €1.98 plan total → banner MUST show.
// RED reason: no budget snapshot column and no banner render path → data-over-budget absent.

describe("@driving_port — Plan shows an over-budget banner when the total exceeds a low cap", () => {
  let tmpDir: string;
  let dbPath: string;
  let serverPort: number;
  let server: { stop(): void } | null = null;

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "discount-hunt-budget-over-"));
    dbPath = join(tmpDir, "budget-over.db");
    seedTwoNinetyNineCentItems(dbPath); // totalSalePrice = 198c

    const { createServer } = await import("../../../src/server.ts");
    const s = await createServer({ port: 0, dbPath });
    server = s;
    serverPort = s.port;

    // Precondition (Pillar 2): set a low €1.00 cap, THEN generate so the cap is snapshotted.
    await saveBudgetCap(serverPort, 1); // €1.00 = 100c < 198c
    await generatePlan(serverPort);
  });

  afterAll(() => {
    server?.stop();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("GET /plan renders the over-budget marker", async () => {
    const response = await fetch(`http://localhost:${serverPort}/plan`);
    expect(response.ok).toBe(true);
    const html = await response.text();
    expect(html).toContain(OVER_BUDGET_MARKER);
  });

  test("the plan still lists the seeded meals (banner augments, does not replace the plan)", async () => {
    // WARN semantics (§2.2): the plan is still shown; the banner is additive, not trim/reject.
    const response = await fetch(`http://localhost:${serverPort}/plan`);
    expect(response.ok).toBe(true);
    const html = await response.text();
    const hasAMeal = html.includes(ITEM_A) || html.includes(ITEM_B);
    expect(hasAMeal).toBe(true);
  });
});

// ─── Scenario 3: No banner when the plan total is under a high cap ─────────────
// §2.2 ("if the snapshotted cap is NULL or not exceeded, no banner").
// HIGH cap €9999 > €1.98 → no banner. Settings-side positive assertion IS red now
// (no budget field), keeping the scenario falsifiable rather than vacuously green.

describe("@driving_port — Plan shows no over-budget banner when the total is under a high cap", () => {
  let tmpDir: string;
  let dbPath: string;
  let serverPort: number;
  let server: { stop(): void } | null = null;

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "discount-hunt-budget-under-"));
    dbPath = join(tmpDir, "budget-under.db");
    seedTwoNinetyNineCentItems(dbPath); // totalSalePrice = 198c

    const { createServer } = await import("../../../src/server.ts");
    const s = await createServer({ port: 0, dbPath });
    server = s;
    serverPort = s.port;

    await saveBudgetCap(serverPort, 9999); // €9999 » €1.98
    await generatePlan(serverPort);
  });

  afterAll(() => {
    server?.stop();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // RED now: no budget field exists, so the high cap never round-trips.
  test("GET /settings shows the saved €9999 cap (proves the high cap was actually stored)", async () => {
    const response = await fetch(`http://localhost:${serverPort}/settings`);
    expect(response.ok).toBe(true);
    const html = await response.text();
    const budgetInput = html.match(/<input\b[^>]*name="budget"[^>]*>/)?.[0] ?? "";
    expect(budgetInput).toMatch(/value="9999(\.00)?"/);
  });

  // Baseline-green honesty anchor (gains teeth post-impl: kills an always-on-banner mutant).
  test("GET /plan does NOT render the over-budget marker", async () => {
    const response = await fetch(`http://localhost:${serverPort}/plan`);
    expect(response.ok).toBe(true);
    const html = await response.text();
    expect(html).not.toContain(OVER_BUDGET_MARKER);
  });
});

// ─── Scenario 4: No banner when no cap is set (NULL) ───────────────────────────
// §2.2 ("if the snapshotted cap is NULL … no banner"). Honesty anchor: proves the banner
// is CAP-DRIVEN, not always-on. No cap is ever POSTed. Baseline-green now by design;
// its teeth are post-impl (kills an always-on-banner mutant on the NULL branch).

describe("@driving_port — Plan shows no over-budget banner when no cap is set", () => {
  let tmpDir: string;
  let dbPath: string;
  let serverPort: number;
  let server: { stop(): void } | null = null;

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "discount-hunt-budget-nocap-"));
    dbPath = join(tmpDir, "budget-nocap.db");
    seedTwoNinetyNineCentItems(dbPath); // totalSalePrice = 198c (would exceed a €1 cap — but none set)

    const { createServer } = await import("../../../src/server.ts");
    const s = await createServer({ port: 0, dbPath });
    server = s;
    serverPort = s.port;

    // No cap ever set (NULL). Generate directly — the plan's snapshotted cap must be NULL.
    await generatePlan(serverPort);
  });

  afterAll(() => {
    server?.stop();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("GET /plan does NOT render the over-budget marker (banner is cap-driven, not always-on)", async () => {
    const response = await fetch(`http://localhost:${serverPort}/plan`);
    expect(response.ok).toBe(true);
    const html = await response.text();
    expect(html).not.toContain(OVER_BUDGET_MARKER);
  });

  test("the plan is still rendered normally (a no-cap plan is an ordinary plan)", async () => {
    const response = await fetch(`http://localhost:${serverPort}/plan`);
    expect(response.ok).toBe(true);
    const html = await response.text();
    const hasAMeal = html.includes(ITEM_A) || html.includes(ITEM_B);
    expect(hasAMeal).toBe(true);
  });
});

// ─── Scenario 5: Snapshot immutability (cap frozen at generation) ──────────────
// §5 (snapshot vs live) + §6 "Budget cap … snapshot-immutability AT" + §7 increment 1.5.
// Mirrors the dietary snapshot-immutability test. Asserted through RENDERED OUTPUT only —
// never the internal budget_cap_cents column (Universe guard). Deliberate single-db exception.
// RED reason: without the snapshot column + banner path, the frozen plan never shows the banner
// in the first place, so the "still present after raising" assertion fires on missing functionality.

describe("@driving_port — An over-budget plan stays over-budget after the cap is raised (snapshot frozen)", () => {
  let tmpDir: string;
  let dbPath: string;
  let serverPort: number;
  let server: { stop(): void } | null = null;

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "discount-hunt-budget-snapshot-"));
    dbPath = join(tmpDir, "budget-snapshot.db");
    seedTwoNinetyNineCentItems(dbPath); // totalSalePrice = 198c

    const { createServer } = await import("../../../src/server.ts");
    const s = await createServer({ port: 0, dbPath });
    server = s;
    serverPort = s.port;

    // Precondition chain (Pillar 2): set a LOW €1.00 cap → generate (frozen at €1.00, over budget)
    // → RAISE the cap to €9999. getOrGenerateCurrentWeekPlan is idempotent, so the same-week
    // GET /plan returns the frozen plan; no regenerate endpoint exists (or is required) here.
    await saveBudgetCap(serverPort, 1);
    await generatePlan(serverPort);
    await saveBudgetCap(serverPort, 9999);
  });

  afterAll(() => {
    server?.stop();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("GET /plan STILL renders the over-budget marker after raising the cap (snapshot frozen at €1.00)", async () => {
    const response = await fetch(`http://localhost:${serverPort}/plan`);
    expect(response.ok).toBe(true);
    const html = await response.text();
    // The live setting is now €9999 (not exceeded); the frozen plan's snapshotted cap is €1.00.
    // A live-reading render would drop the banner — this asserts the snapshot drives it.
    expect(html).toContain(OVER_BUDGET_MARKER);
  });

  test("the raised cap is what the settings page now shows (proves the live setting really changed)", async () => {
    // Contrast: the live setting moved to €9999, yet the frozen plan above still warns.
    const response = await fetch(`http://localhost:${serverPort}/settings`);
    expect(response.ok).toBe(true);
    const html = await response.text();
    const budgetInput = html.match(/<input\b[^>]*name="budget"[^>]*>/)?.[0] ?? "";
    expect(budgetInput).toMatch(/value="9999(\.00)?"/);
  });
});

// ─── Scenario 6: Invalid budget input is rejected and treated as no cap ────────
// §7 increment 1.5 + reuse of the dietary-input-validation discipline (03-08 D1).
// A non-numeric ("abc") or negative ("-5") budget must be treated as NO cap (NULL),
// never persisted as garbage. Parametrized over both bad inputs.
// RED reason: no budget field / validation exists, so GET /settings shows no empty cap value.
// The banner-absence half is a baseline-green honesty anchor (garbage cap must not warn).

describe.each([
  { label: "non-numeric 'abc'", raw: "abc" },
  { label: "negative '-5'", raw: "-5" },
])("@driving_port — Invalid budget input ($label) is rejected and treated as no cap", ({ raw }) => {
  let tmpDir: string;
  let dbPath: string;
  let serverPort: number;
  let server: { stop(): void } | null = null;

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "discount-hunt-budget-invalid-"));
    dbPath = join(tmpDir, "budget-invalid.db");
    seedTwoNinetyNineCentItems(dbPath); // 198c — would exceed a €1 cap, but garbage must persist as NULL

    const { createServer } = await import("../../../src/server.ts");
    const s = await createServer({ port: 0, dbPath });
    server = s;
    serverPort = s.port;

    // Precondition: POST an invalid budget through the driving port, then generate.
    await saveBudgetCap(serverPort, raw);
    await generatePlan(serverPort);
  });

  afterAll(() => {
    server?.stop();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // Anchors on a positive field-exists assertion (RED now — no field), mirroring the dietary
  // invalid-input test (scenario 8), which anchors on 'none' selected rather than a bare absence.
  test("GET /settings shows a budget field with an empty cap (invalid value never persisted)", async () => {
    const response = await fetch(`http://localhost:${serverPort}/settings`);
    expect(response.ok).toBe(true);
    const html = await response.text();
    // RED now: the budget field does not exist yet — this fails for MISSING_FUNCTIONALITY.
    expect(html).toMatch(/<input\b[^>]*name="budget"/);
    // Post-impl semantic: empty cap → no value attribute, or value="" — never the raw garbage.
    const budgetInput = html.match(/<input\b[^>]*name="budget"[^>]*>/)?.[0] ?? "";
    expect(budgetInput).not.toContain(`value="${raw}"`);
    expect(budgetInput).toMatch(/value=""|^(?:(?!value=).)*$/);
  });

  // Baseline-green honesty anchor: garbage-as-NULL must not produce a banner.
  test("GET /plan does NOT render the over-budget marker (garbage treated as no cap)", async () => {
    const response = await fetch(`http://localhost:${serverPort}/plan`);
    expect(response.ok).toBe(true);
    const html = await response.text();
    expect(html).not.toContain(OVER_BUDGET_MARKER);
  });
});
