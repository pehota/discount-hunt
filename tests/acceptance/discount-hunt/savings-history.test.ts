/**
 * Acceptance Tests — SLICE-04: Savings history completion
 *
 * Source of truth: docs/feature/discount-hunt/slices/slice-04-savings-history.md
 * Wave: DISTILL. Authored against DESIGNED behavior, not current code.
 *
 * ALREADY BUILT (do NOT re-test): GET /savings renders a weekly history table with
 * `data-saved-amount` per row (src/savings/http/savings-handler.ts). That works.
 *
 * These tests add the THREE missing SLICE-04 behaviors and are INTENTIONALLY RED
 * until DELIVER extends savings-handler.ts (and, for month/unavailable logic, likely
 * savings-service.ts):
 *
 *   1. This-week breakdown  — data-week-paid / data-week-would-have-paid / data-week-saved
 *   2. Month-to-date total  — data-month-to-date (sum of current-month weeks; prior month EXCLUDED)
 *   3. "Savings unavailable" — totalRegularPrice === 0 weeks render text (not €0.00) and are
 *                              EXCLUDED from the month-to-date sum.
 *
 * Infrastructure (matches multi-store.test.ts / dietary-preferences.test.ts — the real repo idiom):
 *   - Real SQLite DB (temp file) via createDb
 *   - savings_log rows seeded DIRECTLY via the DB client (same direct-insert approach
 *     multi-store.test.ts uses for discount_items). This is legitimate: savings_log is a
 *     driven-internal store, and there is no HTTP write path for it (recordSavings runs inside
 *     the plan-generation transaction, not a seedable endpoint).
 *   - Real HTTP server (createServer) — production composition root
 *   - fetch() against a random port; assertions on rendered HTML
 *
 * RED discipline: every expect() lives in a test body. beforeAll only seeds + starts the
 * server (no expect), so a missing feature surfaces as a failed assertion (MISSING_FUNCTIONALITY),
 * never as a BROKEN describe block.
 *
 * ─── EXACT MARKERS / TEXT CHOSEN (contract for the crafter) ───────────────────
 *   data-week-paid="{cents}"            — current week's totalSalePrice (integer cents)
 *   data-week-would-have-paid="{cents}" — current week's totalRegularPrice (integer cents)
 *   data-week-saved="{cents}"           — current week's savedAmount (integer cents)
 *   data-month-to-date="{cents}"        — running sum of saved_amount across current-month weeks
 *                                         (weeks with totalRegularPrice === 0 are EXCLUDED)
 *   "Savings unavailable"               — literal text rendered for a week whose
 *                                         totalRegularPrice === 0 (instead of "€0.00")
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { createDb } from "../../../src/shared/db.ts";
import { savingsLog, scrapeJobs, discountItems } from "../../../src/shared/schema.ts";
import { storeIdFor } from "../support/test-db.ts";
import { currentWeekMonday } from "../../../src/shared/week.ts";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

// ─── Date helpers (mirror src/shared/week.ts semantics) ───────────────────────

/** Current-month prefix ("YYYY-MM") derived from the same source as production. */
function currentMonthPrefix(): string {
  return currentWeekMonday().slice(0, 7);
}

/**
 * A week_start (Monday, "YYYY-MM-DD") that is clearly in a DIFFERENT calendar month
 * from the current week — two months back — to avoid month-boundary flakiness.
 * Uses UTC arithmetic to match currentWeekMonday()'s UTC Monday contract.
 */
function priorMonthWeekStart(): string {
  const current = new Date(`${currentWeekMonday()}T00:00:00.000Z`);
  const shifted = new Date(current);
  shifted.setUTCMonth(current.getUTCMonth() - 2); // two months back → guaranteed different YYYY-MM
  return shifted.toISOString().slice(0, 10);
}

/**
 * A distinct current-month Monday that is NOT the current week — one week earlier.
 * If subtracting a week crosses into the prior month, fall back to one week later so the
 * seed stays inside the current calendar month regardless of where "today" falls.
 */
function otherCurrentMonthWeekStart(): string {
  const current = new Date(`${currentWeekMonday()}T00:00:00.000Z`);
  const earlier = new Date(current);
  earlier.setUTCDate(current.getUTCDate() - 7);
  if (earlier.toISOString().slice(0, 7) === currentMonthPrefix()) {
    return earlier.toISOString().slice(0, 10);
  }
  const later = new Date(current);
  later.setUTCDate(current.getUTCDate() + 7);
  return later.toISOString().slice(0, 10);
}

// ─── Direct savings_log seeding (driven-internal store; no HTTP write path) ────

interface SavingsSeed {
  weekStart: string;
  savedAmount: number;
  totalSalePrice: number;
  totalRegularPrice: number;
  itemCount?: number;
}

function seedSavings(dbPath: string, seeds: SavingsSeed[]): void {
  const db = createDb(dbPath);
  const now = Date.now();
  for (const s of seeds) {
    db.insert(savingsLog).values({
      id: randomUUID(),
      planId: randomUUID(),
      weekStart: s.weekStart,
      savedAmount: s.savedAmount,
      totalSalePrice: s.totalSalePrice,
      totalRegularPrice: s.totalRegularPrice,
      itemCount: s.itemCount ?? 1,
      recordedAt: now,
    }).run();
  }
}

// ─── Behavior 1: This-week breakdown (paid / would-have-paid / saved) ─────────
// SLICE-04 AC: "Savings tab shows: this week's savings breakdown (paid, would-have-paid, saved €)".
// RED reason: savings-handler renders only a per-row data-saved-amount table; there is no
// this-week breakdown block, so data-week-paid / data-week-would-have-paid / data-week-saved
// attributes are entirely absent from GET /savings.

describe("@driving_port — Savings tab shows this week's breakdown of paid, would-have-paid, and saved", () => {
  let tmpDir: string;
  let dbPath: string;
  let serverPort: number;
  let server: { stop(): void } | null = null;

  // Known current-week values (cents).
  const WEEK_SALE = 1000; // paid
  const WEEK_REGULAR = 1420; // would-have-paid
  const WEEK_SAVED = 420; // saved (= regular - sale)

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "discount-hunt-savings-week-"));
    dbPath = join(tmpDir, "savings-week.db");

    seedSavings(dbPath, [
      {
        weekStart: currentWeekMonday(),
        savedAmount: WEEK_SAVED,
        totalSalePrice: WEEK_SALE,
        totalRegularPrice: WEEK_REGULAR,
      },
    ]);

    const { createServer } = await import("../../../src/server.ts");
    const s = await createServer({ port: 0, dbPath });
    server = s;
    serverPort = s.port;
  });

  afterAll(() => {
    server?.stop();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("the breakdown shows paid (totalSalePrice) as data-week-paid in cents", async () => {
    const response = await fetch(`http://localhost:${serverPort}/savings`);
    expect(response.ok).toBe(true);
    const html = await response.text();
    expect(html).toMatch(new RegExp(`data-week-paid="${WEEK_SALE}"`));
  });

  test("the breakdown shows would-have-paid (totalRegularPrice) as data-week-would-have-paid in cents", async () => {
    const response = await fetch(`http://localhost:${serverPort}/savings`);
    expect(response.ok).toBe(true);
    const html = await response.text();
    expect(html).toMatch(new RegExp(`data-week-would-have-paid="${WEEK_REGULAR}"`));
  });

  test("the breakdown shows saved (savedAmount) as data-week-saved in cents", async () => {
    const response = await fetch(`http://localhost:${serverPort}/savings`);
    expect(response.ok).toBe(true);
    const html = await response.text();
    expect(html).toMatch(new RegExp(`data-week-saved="${WEEK_SAVED}"`));
  });
});

// ─── Behavior 2: Month-to-date total (current-month sum; prior month EXCLUDED) ─
// SLICE-04 AC: "Month-to-date total shown as running sum of current month's weeks".
// The prior-month seed is the honesty anchor: it proves the month filter actually filters,
// not that it sums every row. If the crafter summed all rows, data-month-to-date would be
// 840 + 1120 + 500 = 2460 and the test would (correctly) stay RED.
// RED reason: no data-month-to-date marker exists in the current handler output.

describe("@driving_port — Savings tab shows a month-to-date total over the current month's weeks only", () => {
  let tmpDir: string;
  let dbPath: string;
  let serverPort: number;
  let server: { stop(): void } | null = null;

  const CURRENT_WEEK_SAVED = 840;
  const OTHER_CURRENT_WEEK_SAVED = 1120;
  const PRIOR_MONTH_SAVED = 500; // must be EXCLUDED
  const EXPECTED_MONTH_TOTAL = CURRENT_WEEK_SAVED + OTHER_CURRENT_WEEK_SAVED; // 1960

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "discount-hunt-savings-month-"));
    dbPath = join(tmpDir, "savings-month.db");

    seedSavings(dbPath, [
      // Current-month week #1 (the current week).
      {
        weekStart: currentWeekMonday(),
        savedAmount: CURRENT_WEEK_SAVED,
        totalSalePrice: 2000,
        totalRegularPrice: 2840,
      },
      // Current-month week #2 (a different Monday in the same YYYY-MM).
      {
        weekStart: otherCurrentMonthWeekStart(),
        savedAmount: OTHER_CURRENT_WEEK_SAVED,
        totalSalePrice: 3000,
        totalRegularPrice: 4120,
      },
      // Prior-month week (different YYYY-MM) — the honesty anchor; must NOT be summed.
      {
        weekStart: priorMonthWeekStart(),
        savedAmount: PRIOR_MONTH_SAVED,
        totalSalePrice: 1000,
        totalRegularPrice: 1500,
      },
    ]);

    const { createServer } = await import("../../../src/server.ts");
    const s = await createServer({ port: 0, dbPath });
    server = s;
    serverPort = s.port;
  });

  afterAll(() => {
    server?.stop();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("month-to-date equals the sum of only the current month's weeks", async () => {
    const response = await fetch(`http://localhost:${serverPort}/savings`);
    expect(response.ok).toBe(true);
    const html = await response.text();
    expect(html).toContain(`data-month-to-date="${EXPECTED_MONTH_TOTAL}"`);
  });

  test("the prior-month week's saved amount is EXCLUDED from the month total (honesty anchor)", async () => {
    const response = await fetch(`http://localhost:${serverPort}/savings`);
    expect(response.ok).toBe(true);
    const html = await response.text();
    // If the prior-month row leaked in, the total would be 2460, not 1960.
    expect(html).not.toContain(`data-month-to-date="2460"`);
    expect(html).toContain(`data-month-to-date="${EXPECTED_MONTH_TOTAL}"`);
  });
});

// ─── Behavior 3: "Savings unavailable" when regular price was not captured ────
// SLICE-04 AC: "When regular_price was not captured for a week, 'Savings unavailable'
// shown for that week (not €0)" — and such a week is EXCLUDED from the month-to-date sum.
// A totalRegularPrice === 0 row means no honest savings can be computed.
// RED reason: the current handler renders every row's savedAmount as €{euros} unconditionally;
// there is no "Savings unavailable" branch, and the (absent) month total does not exist to exclude it.

describe("@driving_port — A week with no captured regular price shows 'Savings unavailable' and is excluded from the month total", () => {
  let tmpDir: string;
  let dbPath: string;
  let serverPort: number;
  let server: { stop(): void } | null = null;

  const NORMAL_WEEK_SAVED = 700;
  const NORMAL_WEEK_REGULAR = 2200;
  const NORMAL_WEEK_SALE = 1500;
  // The unavailable week: regular not captured → cannot compute honest savings.
  const UNAVAILABLE_WEEK_SAVED = 0; // whatever was stored is meaningless without a regular price
  const EXPECTED_MONTH_TOTAL = NORMAL_WEEK_SAVED; // only the normal week counts

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "discount-hunt-savings-unavailable-"));
    dbPath = join(tmpDir, "savings-unavailable.db");

    seedSavings(dbPath, [
      // Normal current-month week — shows euros, counts toward the month total.
      {
        weekStart: currentWeekMonday(),
        savedAmount: NORMAL_WEEK_SAVED,
        totalSalePrice: NORMAL_WEEK_SALE,
        totalRegularPrice: NORMAL_WEEK_REGULAR,
      },
      // Current-month week with NO captured regular price → "Savings unavailable".
      {
        weekStart: otherCurrentMonthWeekStart(),
        savedAmount: UNAVAILABLE_WEEK_SAVED,
        totalSalePrice: 900,
        totalRegularPrice: 0, // <-- the trigger
      },
    ]);

    const { createServer } = await import("../../../src/server.ts");
    const s = await createServer({ port: 0, dbPath });
    server = s;
    serverPort = s.port;
  });

  afterAll(() => {
    server?.stop();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("the no-regular-price week renders 'Savings unavailable'", async () => {
    const response = await fetch(`http://localhost:${serverPort}/savings`);
    expect(response.ok).toBe(true);
    const html = await response.text();
    expect(html).toContain("Savings unavailable");
  });

  test("the normal week still shows its euros (proves 'unavailable' is per-week, not global)", async () => {
    const response = await fetch(`http://localhost:${serverPort}/savings`);
    expect(response.ok).toBe(true);
    const html = await response.text();
    // €7.00 for the normal week's 700-cent saving.
    expect(html).toContain("€7.00");
  });

  test("month-to-date equals only the normal week (unavailable week excluded)", async () => {
    const response = await fetch(`http://localhost:${serverPort}/savings`);
    expect(response.ok).toBe(true);
    const html = await response.text();
    expect(html).toContain(`data-month-to-date="${EXPECTED_MONTH_TOTAL}"`);
  });
});

// ─── Behavior 4 (05-03 BLOCKER): CURRENT-week with no captured regular price ──
// The current-week breakdown block must be as honest as the history rows: when the
// current week's totalRegularPrice === 0, it must render "Savings unavailable" instead
// of "Would have paid: €0.00 / Saved: €X". renderThisWeekBreakdown previously ignored
// isSavingsUnavailable and always emitted data-week-would-have-paid.
// RED reason: the this-week block renders data-week-would-have-paid="0" and €0.00 rather
// than "Savings unavailable" — a dishonest breakdown for an uncaptured regular price.

describe("@driving_port — the this-week breakdown shows 'Savings unavailable' when the current week's regular price was not captured", () => {
  let tmpDir: string;
  let dbPath: string;
  let serverPort: number;
  let server: { stop(): void } | null = null;

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "discount-hunt-savings-week-unavailable-"));
    dbPath = join(tmpDir, "savings-week-unavailable.db");

    seedSavings(dbPath, [
      // CURRENT week with NO captured regular price → cannot compute honest savings.
      {
        weekStart: currentWeekMonday(),
        savedAmount: 300, // meaningless without a regular price
        totalSalePrice: 900,
        totalRegularPrice: 0, // <-- the trigger
      },
    ]);

    const { createServer } = await import("../../../src/server.ts");
    const s = await createServer({ port: 0, dbPath });
    server = s;
    serverPort = s.port;
  });

  afterAll(() => {
    server?.stop();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("the this-week block renders 'Savings unavailable'", async () => {
    const response = await fetch(`http://localhost:${serverPort}/savings`);
    expect(response.ok).toBe(true);
    const html = await response.text();
    expect(html).toContain("Savings unavailable");
  });

  test("the this-week block does NOT emit data-week-would-have-paid when regular price is uncaptured", async () => {
    const response = await fetch(`http://localhost:${serverPort}/savings`);
    expect(response.ok).toBe(true);
    const html = await response.text();
    expect(html).not.toContain("data-week-would-have-paid");
  });
});

// ─── Behavior 5 (05-03 INFO/security): store names in the feed are HTML-escaped ─
// SLICE-04 adjacent, discount-feed stored-XSS: scraped store names are untrusted input.
// discount-handler interpolated the store name UNescaped at the staleness-warning and
// store-section <h2> sites (item names were already escaped). A store name carrying an
// HTML special char must be escaped consistently, closing the stored-XSS vector.
// This is a GET / test → seed scrape_jobs + discount_items (not savings_log).
// RED reason: renderStoreSection emits <h2 class="store-name">${storeName}</h2> raw, so
// the raw payload "Aldi<script>" appears verbatim and the escaped form does not.

describe("@driving_port — store names in the discount feed are HTML-escaped (stored-XSS closed)", () => {
  let tmpDir: string;
  let dbPath: string;
  let serverPort: number;
  let server: { stop(): void } | null = null;

  // A store name carrying an HTML-special payload. Seeded WITH an item so the
  // store-section <h2> render path (renderStoreSection) is the one under assertion.
  const MALICIOUS_STORE = "Aldi<script>";
  const ESCAPED_STORE = "Aldi&lt;script&gt;";

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "discount-hunt-store-xss-"));
    dbPath = join(tmpDir, "store-xss.db");

    const db = createDb(dbPath);
    const now = Date.now();
    const jobId = randomUUID();

    db.insert(scrapeJobs).values({
      id: jobId,
      storeId: storeIdFor(db, MALICIOUS_STORE),
      status: "completed",
      startedAt: now - 3600 * 1000,
      completedAt: now - 1800 * 1000, // fresh → no staleness warning
      itemCount: 1,
    }).run();

    db.insert(discountItems).values({
      id: "xss-item-001",
      storeId: storeIdFor(db, MALICIOUS_STORE),
      name: "Brokkoli",
      category: "vegetable",
      regularPrice: 199,
      salePrice: 99,
      validUntil: new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString().slice(0, 10),
      dietaryTags: "[]",
      scrapeJobId: jobId,
      createdAt: now,
    }).run();

    const { createServer } = await import("../../../src/server.ts");
    const s = await createServer({ port: 0, dbPath });
    server = s;
    serverPort = s.port;
  });

  afterAll(() => {
    server?.stop();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("the raw store-name payload does NOT appear in the rendered feed", async () => {
    const response = await fetch(`http://localhost:${serverPort}/`);
    expect(response.ok).toBe(true);
    const html = await response.text();
    expect(html).not.toContain(MALICIOUS_STORE);
  });

  test("the store name is rendered in its HTML-escaped form", async () => {
    const response = await fetch(`http://localhost:${serverPort}/`);
    expect(response.ok).toBe(true);
    const html = await response.text();
    expect(html).toContain(ESCAPED_STORE);
  });
});
