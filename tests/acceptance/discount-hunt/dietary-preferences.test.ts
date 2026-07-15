/**
 * Acceptance Tests — SLICE-03 increment 1: Dietary Preference
 *
 * Source of truth: docs/feature/discount-hunt/design-preferences-model.md §6 (observable-output table).
 * Wave: DISTILL. These tests are authored against the DESIGNED behavior, not current code.
 *
 * They are INTENTIONALLY RED until DELIVER lands:
 *   - GET/POST /settings route (server.ts)
 *   - user_settings table + SQLiteUserPreferencesRepository
 *   - un-hardcoding getWeeklyItems(weekStart, "none") at discount-handler.ts:50 + plan-service.ts:118
 *   - meal_plans.dietary_filter snapshot column + MealPlan.dietaryFilter
 *   - empty-plan warning "No compatible meals found…" + link to /settings
 *
 * Infrastructure (matches multi-store.test.ts — the real repo idiom; there is no
 * test-db.ts / test-server.ts / fake-*-adapter.ts):
 *   - Real SQLite DB (temp file) via createDb
 *   - Real HTTP server (createServer) — production composition root
 *   - fetch() against a random port; assertions on rendered HTML
 *   - The dietary preference precondition is set through POST /settings (the driving port),
 *     NEVER by seeding a user_settings row — that table does not exist yet and is not seedable.
 *
 * RED discipline (per advisor guidance):
 *   - beforeAll performs setup fetches WITHOUT expect() — a fetch to the unbuilt /settings
 *     resolves as a 404 Response (it does not throw), so setup never breaks the describe block.
 *     Every expect() lives in a test body → failures are RED (MISSING_FUNCTIONALITY), not BROKEN.
 *   - Meat/fish items carry distinctive names so presence/absence is a real HTML check,
 *     not a tautology. The `none` control keeps the seed honest (Fixture Theater guard).
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { createDb } from "../../../src/shared/db.ts";
import { scrapeJobs, discountItems } from "../../../src/shared/schema.ts";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

// ─── Domain vocabulary (distinctive, greppable item names per dietary tag) ────

const STORE = "Aldi Süd";

const MEAT_ITEM = "Rindersteak";     // ["contains-meat"] — must vanish under vegetarian
const FISH_ITEM = "Lachsfilet";      // ["contains-fish"] — must vanish under vegetarian
const VEG_ITEM = "Karottensuppe";    // ["vegetarian"]    — survives vegetarian, filtered by vegan
const VEGAN_ITEM = "Tofupfanne";     // ["vegan"]         — survives vegetarian AND vegan

/** ISO date N days from now (validUntil must be >= current Monday to pass getByWeek filter). */
function daysFromNow(n: number): string {
  return new Date(Date.now() + n * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/**
 * Seeds a scrape_jobs row (so the per-store rendering path activates) plus a MIX of
 * discount items with distinct dietary_tags. All items are valid for the current week
 * (validUntil +7d). Mirrors the seeding approach in multi-store.test.ts.
 */
function seedMixedDietaryItems(dbPath: string): void {
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
    itemCount: 4,
  }).run();

  const rows = [
    { id: "diet-meat-001", name: MEAT_ITEM, tags: ["contains-meat"], reg: 599, sale: 399 },
    { id: "diet-fish-001", name: FISH_ITEM, tags: ["contains-fish"], reg: 699, sale: 499 },
    { id: "diet-veg-001", name: VEG_ITEM, tags: ["vegetarian"], reg: 299, sale: 199 },
    { id: "diet-vegan-001", name: VEGAN_ITEM, tags: ["vegan"], reg: 349, sale: 229 },
  ];

  for (const r of rows) {
    db.insert(discountItems).values({
      id: r.id,
      store: STORE,
      name: r.name,
      category: "food",
      regularPrice: r.reg,
      salePrice: r.sale,
      validUntil,
      dietaryTags: JSON.stringify(r.tags),
      scrapeJobId: jobId,
      createdAt: now,
    }).run();
  }
}

/**
 * Seeds ONLY meat/fish items — no vegetarian/vegan survivors. Under a vegetarian
 * restriction this yields ZERO compatible items → the empty-plan warning must show.
 */
function seedMeatFishOnlyItems(dbPath: string): void {
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
    { id: "only-meat-001", name: MEAT_ITEM, tags: ["contains-meat"], reg: 599, sale: 399 },
    { id: "only-fish-001", name: FISH_ITEM, tags: ["contains-fish"], reg: 699, sale: 499 },
  ];

  for (const r of rows) {
    db.insert(discountItems).values({
      id: r.id,
      store: STORE,
      name: r.name,
      category: "food",
      regularPrice: r.reg,
      salePrice: r.sale,
      validUntil,
      dietaryTags: JSON.stringify(r.tags),
      scrapeJobId: jobId,
      createdAt: now,
    }).run();
  }
}

// Item whose name carries HTML special chars — untrusted scraped data (D3, stored-XSS guard).
// Vegan-tagged so it survives every restriction and appears on both GET / and GET /plan.
const XSS_ITEM_NAME = `<script>alert('xss')</script> Bio-Müsli`;
const XSS_ITEM_ESCAPED = `&lt;script&gt;alert(&#39;xss&#39;)&lt;/script&gt; Bio-Müsli`;

/**
 * Seeds a single vegan item whose NAME contains HTML special characters.
 * Used to prove item.name / meal.name are HTML-escaped on render (D3).
 */
function seedHtmlSpecialItem(dbPath: string): void {
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
    itemCount: 1,
  }).run();

  db.insert(discountItems).values({
    id: "xss-001",
    store: STORE,
    name: XSS_ITEM_NAME,
    category: "food",
    regularPrice: 399,
    salePrice: 249,
    validUntil,
    dietaryTags: JSON.stringify(["vegan"]),
    scrapeJobId: jobId,
    createdAt: now,
  }).run();
}

/** POST /settings with a dietary restriction — the driving port that sets the preference. */
async function saveDietaryRestriction(port: number, restriction: string): Promise<Response> {
  const body = new URLSearchParams({ dietary: restriction });
  return fetch(`http://localhost:${port}/settings`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: body.toString(),
    redirect: "manual",
  });
}

// ─── Scenario 1: Settings page loads with current restriction pre-selected ────
// §6 "Settings saved" row (pre-fill half) + §4 pre-selection.
// RED reason: GET /settings → 404 (no route in server.ts).

describe("@driving_port — Settings page shows the current dietary restriction pre-selected", () => {
  let tmpDir: string;
  let dbPath: string;
  let serverPort: number;
  let server: { stop(): void } | null = null;

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "discount-hunt-settings-load-"));
    dbPath = join(tmpDir, "settings-load.db");
    seedMixedDietaryItems(dbPath);

    const { createServer } = await import("../../../src/server.ts");
    serverPort = 4300 + Math.floor(Math.random() * 99);
    server = await createServer({ port: serverPort, dbPath });

    // Precondition: a restriction was previously saved (driving port, not DB seed).
    // No expect() here — a 404 from the unbuilt route must not break the describe.
    await saveDietaryRestriction(serverPort, "vegetarian");
  });

  afterAll(() => {
    server?.stop();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("GET /settings returns HTML with a dietary dropdown", async () => {
    const response = await fetch(`http://localhost:${serverPort}/settings`);
    expect(response.ok).toBe(true);
    const html = await response.text();
    // A <select> for dietary restriction with all three options
    expect(html).toMatch(/<select[^>]*name="dietary"/);
    expect(html).toContain("Vegetarian");
    expect(html).toContain("Vegan");
    expect(html).toContain("None");
  });

  test("the previously-saved restriction (vegetarian) is marked selected", async () => {
    const response = await fetch(`http://localhost:${serverPort}/settings`);
    expect(response.ok).toBe(true);
    const html = await response.text();
    // The vegetarian option must carry the `selected` attribute.
    // Match either attribute order so a correct impl is never a false-RED.
    const vegOption = html.match(/<option\b[^>]*value="vegetarian"[^>]*>/)?.[0] ?? "";
    expect(vegOption).toContain("selected");
  });
});

// ─── Scenario 2: Saving a restriction confirms and persists ───────────────────
// §6 "Settings saved" row.
// RED reason: POST /settings → 404; response never contains "Settings saved".

describe("@driving_port — Saving a dietary restriction confirms and pre-fills on reload", () => {
  let tmpDir: string;
  let dbPath: string;
  let serverPort: number;
  let server: { stop(): void } | null = null;

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "discount-hunt-settings-save-"));
    dbPath = join(tmpDir, "settings-save.db");
    seedMixedDietaryItems(dbPath);

    const { createServer } = await import("../../../src/server.ts");
    serverPort = 4400 + Math.floor(Math.random() * 99);
    server = await createServer({ port: serverPort, dbPath });
  });

  afterAll(() => {
    server?.stop();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("POST /settings with vegetarian responds with 'Settings saved'", async () => {
    const response = await fetch(`http://localhost:${serverPort}/settings`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ dietary: "vegetarian" }).toString(),
    });
    expect(response.ok).toBe(true);
    const html = await response.text();
    expect(html).toContain("Settings saved");
  });

  test("a subsequent GET /settings shows vegetarian pre-selected", async () => {
    // Save first (driving port), then re-read.
    await saveDietaryRestriction(serverPort, "vegetarian");
    const response = await fetch(`http://localhost:${serverPort}/settings`);
    expect(response.ok).toBe(true);
    const html = await response.text();
    const vegOption = html.match(/<option\b[^>]*value="vegetarian"[^>]*>/)?.[0] ?? "";
    expect(vegOption).toContain("selected");
  });
});

// ─── Scenario 3: Dashboard filters LIVE (no regenerate) ───────────────────────
// §6 "Dietary — dashboard filter (LIVE)" row.
// Parametrized over restrictions (advisor: parametrize HTTP variants, do not wrap fast-check
// around fetch — the DB is seeded once per describe and isCompatible is already PBT-covered).
// RED reason: discount-handler.ts:50 hardcodes getWeeklyItems(weekStart, "none"), so meat/fish
// items still appear under vegetarian.

describe("@driving_port — Discount dashboard re-filters live when the restriction changes", () => {
  let tmpDir: string;
  let dbPath: string;
  let serverPort: number;
  let server: { stop(): void } | null = null;

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "discount-hunt-dashboard-live-"));
    dbPath = join(tmpDir, "dashboard-live.db");
    seedMixedDietaryItems(dbPath);

    const { createServer } = await import("../../../src/server.ts");
    serverPort = 4500 + Math.floor(Math.random() * 99);
    server = await createServer({ port: serverPort, dbPath });
  });

  afterAll(() => {
    server?.stop();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("with vegetarian saved, the dashboard shows zero meat/fish items", async () => {
    await saveDietaryRestriction(serverPort, "vegetarian");
    const response = await fetch(`http://localhost:${serverPort}/`);
    expect(response.ok).toBe(true);
    const html = await response.text();

    // Non-compliant items must be filtered out immediately (live read, no regenerate).
    expect(html).not.toContain(MEAT_ITEM);
    expect(html).not.toContain(FISH_ITEM);
    // Compatible items must remain — proves it filtered, not emptied.
    expect(html).toContain(VEG_ITEM);
    expect(html).toContain(VEGAN_ITEM);
  });

  test("with vegan saved, the dashboard shows only the vegan item", async () => {
    await saveDietaryRestriction(serverPort, "vegan");
    const response = await fetch(`http://localhost:${serverPort}/`);
    expect(response.ok).toBe(true);
    const html = await response.text();

    expect(html).not.toContain(MEAT_ITEM);
    expect(html).not.toContain(FISH_ITEM);
    expect(html).not.toContain(VEG_ITEM); // vegetarian-only item is not vegan
    expect(html).toContain(VEGAN_ITEM);
  });

  // The `none` control — anti-Fixture-Theater. If seeded meat items were absent, the
  // vegetarian test above would pass with zero production code. This proves they exist.
  test("with none saved, all four items (including meat and fish) reappear on the next load", async () => {
    await saveDietaryRestriction(serverPort, "none");
    const response = await fetch(`http://localhost:${serverPort}/`);
    expect(response.ok).toBe(true);
    const html = await response.text();

    expect(html).toContain(MEAT_ITEM);
    expect(html).toContain(FISH_ITEM);
    expect(html).toContain(VEG_ITEM);
    expect(html).toContain(VEGAN_ITEM);
  });
});

// ─── Scenario 4: Plan generation respects the restriction ─────────────────────
// §6 "Dietary — plan filter (generation)" row.
// RED reason: plan-service.ts:118 hardcodes getWeeklyItems(weekStart, "none"), so meat/fish
// meals still enter the generated plan under vegetarian.

describe("@driving_port — Generated meal plan excludes meat/fish under a vegetarian restriction", () => {
  let tmpDir: string;
  let dbPath: string;
  let serverPort: number;
  let server: { stop(): void } | null = null;

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "discount-hunt-plan-filter-"));
    dbPath = join(tmpDir, "plan-filter.db");
    seedMixedDietaryItems(dbPath);

    const { createServer } = await import("../../../src/server.ts");
    serverPort = 4600 + Math.floor(Math.random() * 99);
    server = await createServer({ port: serverPort, dbPath });

    // Precondition: vegetarian saved, then generate a plan (POST returns 303).
    await saveDietaryRestriction(serverPort, "vegetarian");
    await fetch(`http://localhost:${serverPort}/plan/generate`, {
      method: "POST",
      redirect: "manual",
    });
  });

  afterAll(() => {
    server?.stop();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("no meal in the plan references a meat item", async () => {
    const response = await fetch(`http://localhost:${serverPort}/plan`);
    expect(response.ok).toBe(true);
    const html = await response.text();
    expect(html).not.toContain(MEAT_ITEM);
  });

  test("no meal in the plan references a fish item", async () => {
    const response = await fetch(`http://localhost:${serverPort}/plan`);
    expect(response.ok).toBe(true);
    const html = await response.text();
    expect(html).not.toContain(FISH_ITEM);
  });

  test("the plan still contains vegetarian-compatible meals (not empty)", async () => {
    const response = await fetch(`http://localhost:${serverPort}/plan`);
    expect(response.ok).toBe(true);
    const html = await response.text();
    // At least one compatible item's name must appear as a meal — proves filtered, not empty.
    const hasCompatible = html.includes(VEG_ITEM) || html.includes(VEGAN_ITEM);
    expect(hasCompatible).toBe(true);
  });
});

// ─── Scenario 5: Snapshot immutability (dietary_filter frozen at generation) ──
// §6 "Dietary — snapshot immutability" row + §5 (snapshot vs live).
// Asserted through RENDERED OUTPUT only — never the internal dietary_filter column (Universe guard).
// RED reason: without the un-hardcoding + snapshot column, the frozen plan is not vegetarian
// in the first place (meat appears), so the immutability assertion fires on missing functionality.

describe("@driving_port — An existing vegetarian plan stays meat-free after the setting changes to none", () => {
  let tmpDir: string;
  let dbPath: string;
  let serverPort: number;
  let server: { stop(): void } | null = null;

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "discount-hunt-snapshot-"));
    dbPath = join(tmpDir, "snapshot.db");
    seedMixedDietaryItems(dbPath);

    const { createServer } = await import("../../../src/server.ts");
    serverPort = 4700 + Math.floor(Math.random() * 99);
    server = await createServer({ port: serverPort, dbPath });

    // Precondition chain (Pillar 2): save vegetarian → generate a plan (frozen at vegetarian)
    // → switch the setting to none. getOrGenerateCurrentWeekPlan is idempotent, so the same-week
    // GET /plan returns the frozen plan; no regenerate endpoint is required.
    await saveDietaryRestriction(serverPort, "vegetarian");
    await fetch(`http://localhost:${serverPort}/plan/generate`, {
      method: "POST",
      redirect: "manual",
    });
    await saveDietaryRestriction(serverPort, "none");
  });

  afterAll(() => {
    server?.stop();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("the existing plan still shows zero meat items after switching to none", async () => {
    const response = await fetch(`http://localhost:${serverPort}/plan`);
    expect(response.ok).toBe(true);
    const html = await response.text();
    expect(html).not.toContain(MEAT_ITEM);
  });

  test("the existing plan still shows zero fish items after switching to none", async () => {
    const response = await fetch(`http://localhost:${serverPort}/plan`);
    expect(response.ok).toBe(true);
    const html = await response.text();
    expect(html).not.toContain(FISH_ITEM);
  });

  // Live-vs-snapshot contrast in one assertion pair: the dashboard (live) now shows meat again,
  // while the plan (snapshot) still hides it — proving the plan is frozen, not merely lucky.
  test("meanwhile the dashboard (live) shows meat again, proving the plan is frozen not coincidental", async () => {
    const dashboard = await (await fetch(`http://localhost:${serverPort}/`)).text();
    const plan = await (await fetch(`http://localhost:${serverPort}/plan`)).text();

    expect(dashboard).toContain(MEAT_ITEM); // live read reflects none
    expect(plan).not.toContain(MEAT_ITEM);  // snapshot stays vegetarian
  });
});

// ─── Scenario 6: Empty-plan warning ───────────────────────────────────────────
// §6 "Empty-plan warning" row + §4.
// Own seed: meat/fish ONLY → vegetarian yields 0 compatible items.
// RED reason: the "No compatible meals found…" message + href="/settings" do not exist,
// and (pre-fix) filtering does not even run, so the warning is absent regardless.

describe("@driving_port — Plan view warns and links to settings when no compatible items exist", () => {
  let tmpDir: string;
  let dbPath: string;
  let serverPort: number;
  let server: { stop(): void } | null = null;

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "discount-hunt-empty-plan-"));
    dbPath = join(tmpDir, "empty-plan.db");
    seedMeatFishOnlyItems(dbPath); // only contains-meat / contains-fish items

    const { createServer } = await import("../../../src/server.ts");
    serverPort = 4800 + Math.floor(Math.random() * 99);
    server = await createServer({ port: serverPort, dbPath });

    // Precondition: vegetarian saved → every seeded item is incompatible → 0 compatible.
    await saveDietaryRestriction(serverPort, "vegetarian");
    await fetch(`http://localhost:${serverPort}/plan/generate`, {
      method: "POST",
      redirect: "manual",
    });
  });

  afterAll(() => {
    server?.stop();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("the plan view shows 'No compatible meals found'", async () => {
    const response = await fetch(`http://localhost:${serverPort}/plan`);
    expect(response.ok).toBe(true);
    const html = await response.text();
    expect(html).toContain("No compatible meals found");
  });

  test("the plan view offers a direct link to /settings", async () => {
    const response = await fetch(`http://localhost:${serverPort}/plan`);
    expect(response.ok).toBe(true);
    const html = await response.text();
    expect(html).toMatch(/href="\/settings"/);
  });

  test("neither the meat nor fish item appears as a meal", async () => {
    const response = await fetch(`http://localhost:${serverPort}/plan`);
    expect(response.ok).toBe(true);
    const html = await response.text();
    expect(html).not.toContain(MEAT_ITEM);
    expect(html).not.toContain(FISH_ITEM);
  });
});

// ─── Scenario 7: Empty plan distinguishes NO-DATA from RESTRICTION-FILTERED ────
// Step 03-07 — review-driven fix.
// No seed (empty discount DB) + default 'none' restriction → generatePlan builds
// all-null meals with dietaryFilter="none". The plan view must steer the user to
// "check back after the next catalogue update", NOT to change dietary restrictions.
// RED reason: plan-handler renders the restriction warning ("No compatible meals
// found with your current restrictions" + /settings steer) for ANY empty plan,
// including a no-data plan — the wrong contract for a fresh-install/failed-scrape user.

describe("@driving_port — Empty plan distinguishes no-data from restriction-filtered", () => {
  let tmpDir: string;
  let dbPath: string;
  let serverPort: number;
  let server: { stop(): void } | null = null;

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "discount-hunt-no-data-plan-"));
    dbPath = join(tmpDir, "no-data-plan.db");
    // NO seeding — empty discount DB (fresh install / failed scrape).

    const { createServer } = await import("../../../src/server.ts");
    serverPort = 4900 + Math.floor(Math.random() * 99);
    server = await createServer({ port: serverPort, dbPath });

    // Default restriction 'none' set explicitly, then generate a plan over an empty DB.
    await saveDietaryRestriction(serverPort, "none");
    await fetch(`http://localhost:${serverPort}/plan/generate`, {
      method: "POST",
      redirect: "manual",
    });
  });

  afterAll(() => {
    server?.stop();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("the plan view shows a no-discounts-available message", async () => {
    const response = await fetch(`http://localhost:${serverPort}/plan`);
    expect(response.ok).toBe(true);
    const html = await response.text();
    expect(html).toContain("No discounts available");
  });

  test("the plan view does NOT show the restriction-filtered warning", async () => {
    const response = await fetch(`http://localhost:${serverPort}/plan`);
    expect(response.ok).toBe(true);
    const html = await response.text();
    expect(html).not.toContain("No compatible meals found with your current restrictions");
  });
});

// ─── Scenario 8 (D1): Invalid dietary input is rejected/defaulted to none ──────
// Step 03-08 — adversarial-review BLOCKER. settings-handler `as DietaryRestriction`
// cast is compile-only; a POST of 'banana' persists garbage that isCompatible treats
// as vegan-only (unknown restriction falls through to tags.includes("vegan")).
// RED reason: 'banana' persists → GET /settings has no option selected as none, and the
// dashboard filters as vegan (meat/fish/vegetarian items vanish), NEVER showing all items.

describe("@driving_port — Invalid dietary input is rejected and defaults to none", () => {
  let tmpDir: string;
  let dbPath: string;
  let serverPort: number;
  let server: { stop(): void } | null = null;

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "discount-hunt-invalid-dietary-"));
    dbPath = join(tmpDir, "invalid-dietary.db");
    seedMixedDietaryItems(dbPath);

    const { createServer } = await import("../../../src/server.ts");
    serverPort = 5000 + Math.floor(Math.random() * 99);
    server = await createServer({ port: serverPort, dbPath });

    // Precondition: an invalid dietary value is POSTed through the driving port.
    await saveDietaryRestriction(serverPort, "banana");
  });

  afterAll(() => {
    server?.stop();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("GET /settings shows 'none' selected (invalid value never persisted)", async () => {
    const response = await fetch(`http://localhost:${serverPort}/settings`);
    expect(response.ok).toBe(true);
    const html = await response.text();
    const noneOption = html.match(/<option\b[^>]*value="none"[^>]*>/)?.[0] ?? "";
    expect(noneOption).toContain("selected");
    // And no bogus 'banana' option leaked into the form.
    expect(html).not.toContain('value="banana"');
  });

  test("the dashboard behaves as none — all items shown, never vegan-filtered", async () => {
    const response = await fetch(`http://localhost:${serverPort}/`);
    expect(response.ok).toBe(true);
    const html = await response.text();
    // Behaves as none: every seeded item appears. If 'banana' persisted, isCompatible
    // would treat it as vegan-only and meat/fish/vegetarian items would vanish.
    expect(html).toContain(MEAT_ITEM);
    expect(html).toContain(FISH_ITEM);
    expect(html).toContain(VEG_ITEM);
    expect(html).toContain(VEGAN_ITEM);
  });
});

// ─── Scenario 9 (D2): An EMPTY plan is transient — it refreshes under the current restriction ──
// Step 07-02 — BEHAVIOR CORRECTION driven by a reproduced user bug ("after generating a plan it
// says 'no discounts' while discounts are listed"). Reproduced twice. The OLD D2 asserted that a
// frozen EMPTY vegetarian plan STAYS "No compatible meals found" after switching to none — that
// assertion CONTRADICTS the bug report and is therefore re-scoped here.
//
// GUIDING PRINCIPLE: an empty plan is a transient "couldn't build one" state — nothing to freeze;
// it must reflect the CURRENT restriction and pick up newly-usable items. A NON-EMPTY plan is a
// durable weekly commitment — frozen until next week. The split is exactly items.length === 0.
//
// CORRECTED behavior: meat/fish-only DB + vegetarian saved → the plan is empty ("No compatible
// meals found"). Switch the restriction to none → GET /plan now SHOWS the meat item, because the
// empty plan was never frozen and re-queries under the new restriction.
//
// Coverage note: the old "discriminator reads live vs snapshot" mutant is eliminated BY
// CONSTRUCTION — empty plans no longer persist, so a fresh empty plan's snapshot always equals the
// live setting. There is no live-vs-snapshot divergence left to test for an empty plan; coverage is
// not dropped, the whole bug class is gone. Snapshot immutability for NON-EMPTY plans stays covered
// by Scenario 5 (untouched).
//
// RED reason against CURRENT code: the guard `items.length > 0 || plan.dietaryFilter !== "none"`
// still persists the empty vegetarian plan (dietaryFilter "vegetarian" !== "none"), so the frozen
// empty plan is returned after switching to none and the meat item never surfaces.

describe("@driving_port — An empty plan is transient and refreshes under the current restriction", () => {
  let tmpDir: string;
  let dbPath: string;
  let serverPort: number;
  let server: { stop(): void } | null = null;

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "discount-hunt-empty-plan-refresh-"));
    dbPath = join(tmpDir, "empty-plan-refresh.db");
    seedMeatFishOnlyItems(dbPath); // 0 vegetarian survivors → empty plan under vegetarian

    const { createServer } = await import("../../../src/server.ts");
    serverPort = 5100 + Math.floor(Math.random() * 99);
    server = await createServer({ port: serverPort, dbPath });

    // Precondition chain (Pillar 2): save vegetarian → generate an EMPTY plan (0 compatible items)
    // → switch the restriction to none. Because the plan is empty, it must NOT be frozen; the next
    // GET /plan re-queries under "none" and the meat item becomes visible.
    await saveDietaryRestriction(serverPort, "vegetarian");
    await fetch(`http://localhost:${serverPort}/plan/generate`, {
      method: "POST",
      redirect: "manual",
    });
    await saveDietaryRestriction(serverPort, "none");
  });

  afterAll(() => {
    server?.stop();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("GET /plan now SHOWS the meat item (the empty plan refreshed under the new restriction)", async () => {
    const response = await fetch(`http://localhost:${serverPort}/plan`);
    expect(response.ok).toBe(true);
    const html = await response.text();
    // The empty vegetarian plan was transient; under "none" the meat item is now compatible.
    expect(html).toContain(MEAT_ITEM);
  });

  test("GET /plan no longer shows 'No compatible meals found' (the empty plan did not stick)", async () => {
    const response = await fetch(`http://localhost:${serverPort}/plan`);
    expect(response.ok).toBe(true);
    const html = await response.text();
    // A frozen empty vegetarian plan (the bug) would keep rendering this after switching to none.
    expect(html).not.toContain("No compatible meals found");
  });
});

// ─── Scenario 10 (D3): Untrusted item names are HTML-escaped on render ────────
// Step 03-08 — stored-XSS BLOCKER. Scraped item.name is interpolated unescaped into
// GET / (discount-handler) and GET /plan (plan-handler via meal.name). A name containing
// <script> must render escaped, never as a raw executable tag.
// RED reason: no escapeHtml applied → raw "<script>" appears in both responses.

describe("@driving_port — Item names with HTML special chars are escaped on render", () => {
  let tmpDir: string;
  let dbPath: string;
  let serverPort: number;
  let server: { stop(): void } | null = null;

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "discount-hunt-html-escape-"));
    dbPath = join(tmpDir, "html-escape.db");
    seedHtmlSpecialItem(dbPath);

    const { createServer } = await import("../../../src/server.ts");
    serverPort = 5200 + Math.floor(Math.random() * 99);
    server = await createServer({ port: serverPort, dbPath });

    await saveDietaryRestriction(serverPort, "none");
    await fetch(`http://localhost:${serverPort}/plan/generate`, {
      method: "POST",
      redirect: "manual",
    });
  });

  afterAll(() => {
    server?.stop();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("GET / renders the item name escaped (no raw <script>)", async () => {
    const response = await fetch(`http://localhost:${serverPort}/`);
    expect(response.ok).toBe(true);
    const html = await response.text();
    expect(html).not.toContain("<script>alert('xss')</script>");
    expect(html).toContain(XSS_ITEM_ESCAPED);
  });

  test("GET /plan renders the meal name escaped (no raw <script>)", async () => {
    const response = await fetch(`http://localhost:${serverPort}/plan`);
    expect(response.ok).toBe(true);
    const html = await response.text();
    expect(html).not.toContain("<script>alert('xss')</script>");
    expect(html).toContain(XSS_ITEM_ESCAPED);
  });
});
