/**
 * Plan Freshness — step 07-01 (bugfix)
 *
 * Bug: getOrGenerateCurrentWeekPlan persisted an EMPTY no-data plan (items.length === 0
 * → all-null meals, 0 estimated savings). Because get-or-create returns the persisted
 * plan forever, a plan generated BEFORE any discounts existed kept showing
 * "No discounts available" even after discounts arrived — while the live dashboard (GET /)
 * showed them. It also wrote a bogus 0-savings savings_log row.
 *
 * Fix: do not persist a no-data empty plan (dietaryFilter === "none" AND zero items) so it
 * becomes non-sticky (the next read re-queries). Non-empty plans stay saved + idempotent;
 * restriction-filtered empty plans (dietaryFilter !== "none") stay persisted so their frozen
 * snapshot survives a later settings change (03-08 D2 snapshot immutability).
 *
 * Infrastructure (mirrors multi-store.test.ts):
 *   - Real SQLite DB (temp file)
 *   - Real HTTP server (createServer)
 *   - Direct db.insert(discountItems) seeding
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { sql } from "drizzle-orm";
import { createDb, type DbClient } from "../../../src/shared/db.ts";
import { scrapeJobs, discountItems } from "../../../src/shared/schema.ts";
import { currentWeekMonday } from "../../../src/shared/week.ts";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

const STORE = "Aldi Süd";
const SEEDED_ITEM = "Brokkoli";

/** validUntil safely inside the current week so getByWeek (valid_until >= weekStart) keeps it. */
function currentWeekValidUntil(): string {
  // 6 days after this week's Monday is always within the current ISO week.
  const monday = new Date(`${currentWeekMonday()}T00:00:00.000Z`);
  monday.setUTCDate(monday.getUTCDate() + 6);
  return monday.toISOString().slice(0, 10);
}

/** Count savings_log rows for the current week (mirrors the user-settings rowCount idiom). */
function savingsRowCountForCurrentWeek(db: DbClient): number {
  const weekStart = currentWeekMonday();
  // drizzle-orm/bun-sqlite .get() returns a positional value array.
  const row = db.get<[number]>(
    sql`SELECT COUNT(*) AS n FROM savings_log WHERE week_start = ${weekStart}`,
  );
  return row?.[0] ?? 0;
}

/** Insert a discount item valid for the current week under a completed scrape job. */
function seedDiscountItem(
  db: DbClient,
  jobId: string,
  id: string,
  name: string,
  tags: string[] = [],
): void {
  const now = Date.now();
  db.insert(discountItems).values({
    id,
    store: STORE,
    name,
    category: "vegetable",
    regularPrice: 149,
    salePrice: 79,
    validUntil: currentWeekValidUntil(),
    dietaryTags: JSON.stringify(tags),
    scrapeJobId: jobId,
    createdAt: now,
  }).run();
}

/** POST /settings with a dietary restriction — the driving port that sets the preference. */
async function saveDietaryRestriction(port: number, restriction: string): Promise<Response> {
  return fetch(`http://localhost:${port}/settings`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ dietary: restriction }).toString(),
    redirect: "manual",
  });
}

function seedCompletedJob(db: DbClient): string {
  const now = Date.now();
  const jobId = randomUUID();
  db.insert(scrapeJobs).values({
    id: jobId,
    store: STORE,
    status: "completed",
    startedAt: now - 3600 * 1000,
    completedAt: now - 1800 * 1000,
    itemCount: 0,
  }).run();
  return jobId;
}

// ─── Test (a): a no-data plan is non-sticky — discounts arriving later become visible ──
// RED reason (pre-fix): POST /plan/generate over an empty DB persists an all-null "none"
// plan; that frozen plan is returned forever, so after discounts arrive GET /plan still
// shows "No discounts available" and never surfaces the seeded item.

describe("@driving_port — a plan generated before discounts arrive does not cache-stale", () => {
  let tmpDir: string;
  let dbPath: string;
  let serverPort: number;
  let server: { stop(): void } | null = null;

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "discount-hunt-plan-freshness-a-"));
    dbPath = join(tmpDir, "freshness-a.db");

    // Given: an empty discount DB (fresh install / discounts not scraped yet).
    const db = createDb(dbPath);

    const { createServer } = await import("../../../src/server.ts");
    serverPort = 6200 + Math.floor(Math.random() * 400); // port range 6200–6599
    server = await createServer({ port: serverPort, dbPath });

    // When: a plan is generated while there are no discounts (default 'none' restriction).
    await fetch(`http://localhost:${serverPort}/plan/generate`, {
      method: "POST",
      redirect: "manual",
    });

    // And: discounts arrive afterwards (seeded directly, valid for the current week).
    const jobId = seedCompletedJob(db);
    seedDiscountItem(db, jobId, "fresh-arrival-001", SEEDED_ITEM);
  });

  afterAll(() => {
    server?.stop();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("GET /plan surfaces the newly-arrived item", async () => {
    const response = await fetch(`http://localhost:${serverPort}/plan`);
    expect(response.ok).toBe(true);
    const html = await response.text();
    expect(html).toContain(SEEDED_ITEM);
  });

  test("GET /plan no longer shows the no-data 'No discounts available' message", async () => {
    const response = await fetch(`http://localhost:${serverPort}/plan`);
    expect(response.ok).toBe(true);
    const html = await response.text();
    expect(html).not.toContain("No discounts available");
  });
});

// ─── Test (a2): the VEGETARIAN empty-plan data-arrival case — the path still broken ────
// Step 07-02 — BEHAVIOR CORRECTION driven by the reproduced user bug ("after generating a plan it
// says 'no discounts' while discounts are listed"). Test (a) above only proved the `none` restriction
// path. The restriction-filtered empty plan is the path STILL broken under the current guard:
// `items.length > 0 || plan.dietaryFilter !== "none"` persists a vegetarian empty plan (dietaryFilter
// "vegetarian" !== "none"), freezing it forever. When a compatible vegetarian item arrives later,
// GET /plan keeps returning the frozen empty plan and never surfaces the new item.
//
// GUIDING PRINCIPLE: an empty plan is a transient "couldn't build one" state regardless of the
// restriction that produced it — it must pick up newly-arrived compatible items. The freeze applies
// only to NON-EMPTY plans. The split is exactly items.length === 0.
//
// RED reason against CURRENT code: the vegetarian empty plan is persisted, so GET /plan returns the
// frozen empty plan — the newly-seeded vegetarian item is absent and "No compatible meals found"
// still shows.

const VEG_SEEDED_ITEM = "Spinatsuppe"; // ["vegetarian"] — compatible under a vegetarian restriction

describe("@driving_port — a vegetarian empty plan does not cache-stale when a compatible item arrives", () => {
  let tmpDir: string;
  let dbPath: string;
  let serverPort: number;
  let server: { stop(): void } | null = null;

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "discount-hunt-plan-freshness-veg-"));
    dbPath = join(tmpDir, "freshness-veg.db");

    // Given: an empty discount DB (no compatible vegetarian items yet).
    const db = createDb(dbPath);

    const { createServer } = await import("../../../src/server.ts");
    serverPort = 6900 + Math.floor(Math.random() * 90); // port range 6900–6989
    server = await createServer({ port: serverPort, dbPath });

    // And: the user has a vegetarian restriction saved (driving port).
    await saveDietaryRestriction(serverPort, "vegetarian");

    // When: a plan is generated while there are no compatible items → an EMPTY vegetarian plan.
    await fetch(`http://localhost:${serverPort}/plan/generate`, {
      method: "POST",
      redirect: "manual",
    });

    // And: a compatible vegetarian discount arrives afterwards (valid for the current week).
    const jobId = seedCompletedJob(db);
    seedDiscountItem(db, jobId, "veg-arrival-001", VEG_SEEDED_ITEM, ["vegetarian"]);
  });

  afterAll(() => {
    server?.stop();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("GET /plan surfaces the newly-arrived vegetarian item", async () => {
    const response = await fetch(`http://localhost:${serverPort}/plan`);
    expect(response.ok).toBe(true);
    const html = await response.text();
    expect(html).toContain(VEG_SEEDED_ITEM);
  });

  test("GET /plan no longer shows 'No compatible meals found' once a compatible item exists", async () => {
    const response = await fetch(`http://localhost:${serverPort}/plan`);
    expect(response.ok).toBe(true);
    const html = await response.text();
    expect(html).not.toContain("No compatible meals found");
  });
});

// ─── Test (b): a non-empty plan stays saved, idempotent, with exactly one savings row ──
// Guards against the fix accidentally making non-empty plans non-sticky and against
// duplicate savings_log rows (savePlan stays INSERT-only, D23 one row per week).

describe("@driving_port — a non-empty plan is idempotent and writes exactly one savings row", () => {
  let tmpDir: string;
  let dbPath: string;
  let serverPort: number;
  let server: { stop(): void } | null = null;
  let inspectDb: DbClient;

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "discount-hunt-plan-freshness-b-"));
    dbPath = join(tmpDir, "freshness-b.db");

    // Given: discounts exist for the current week.
    const db = createDb(dbPath);
    const jobId = seedCompletedJob(db);
    seedDiscountItem(db, jobId, "present-item-001", SEEDED_ITEM);

    const { createServer } = await import("../../../src/server.ts");
    serverPort = 6600 + Math.floor(Math.random() * 300); // port range 6600–6899
    server = await createServer({ port: serverPort, dbPath });

    // Separate handle to inspect savings_log after the reads.
    inspectDb = createDb(dbPath);
  });

  afterAll(() => {
    server?.stop();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("two GET /plan reads return the same persisted plan (idempotent)", async () => {
    const first = await (await fetch(`http://localhost:${serverPort}/plan`)).text();
    const second = await (await fetch(`http://localhost:${serverPort}/plan`)).text();

    const extractSavings = (html: string): string | null =>
      html.match(/data-estimated-savings="(\d+)"/)?.[1] ?? null;

    const firstSavings = extractSavings(first);
    expect(firstSavings).not.toBeNull();
    expect(extractSavings(second)).toBe(firstSavings);
    expect(first).toContain(SEEDED_ITEM);
  });

  test("exactly one savings_log row exists for the current week", async () => {
    // Ensure the plan has been generated at least once.
    await fetch(`http://localhost:${serverPort}/plan`);
    expect(savingsRowCountForCurrentWeek(inspectDb)).toBe(1);
  });
});
