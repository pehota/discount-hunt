/**
 * Unit tests for SavingsService.getSummary() (step 05-01).
 *
 * Drives the aggregation view model powering the SLICE-04 savings UI:
 *   { history, thisWeek, monthToDateCents, unavailableWeekStarts }
 *
 * Two independent month-to-date filters (the ATs' honesty anchors):
 *   1. MONTH filter  — weekStart.slice(0,7) === currentWeekMonday().slice(0,7)
 *   2. REGULAR filter — totalRegularPrice !== 0 (regular price actually captured)
 *
 * TEST PARADIGM: property-based (fast-check) over seeded records, asserting the
 * two-filter invariant across arbitrary universes, plus targeted anchor cases.
 * Real SQLite via createDb round-trips the records through the repository so the
 * service is exercised port-to-port (driving port = getSummary()).
 */

import { describe, test, expect } from "bun:test";
import fc from "fast-check";
import { randomUUID } from "node:crypto";
import { createDb } from "../shared/db.ts";
import { currentWeekMonday } from "../shared/week.ts";
import { SQLiteSavingsRepository, type SavingsRecord } from "./adapters/sqlite-savings-repository.ts";
import { SavingsService } from "./savings-service.ts";

interface Seed {
  weekStart: string;
  savedAmount: number;
  totalSalePrice: number;
  totalRegularPrice: number;
}

function serviceWith(seeds: Seed[]): SavingsService {
  const db = createDb(":memory:");
  const repo = new SQLiteSavingsRepository(db);
  const service = new SavingsService(repo);
  for (const seed of seeds) {
    const record: SavingsRecord = {
      id: randomUUID(),
      planId: randomUUID(),
      weekStart: seed.weekStart,
      savedAmount: seed.savedAmount,
      totalSalePrice: seed.totalSalePrice,
      totalRegularPrice: seed.totalRegularPrice,
      itemCount: 1,
      recordedAt: Date.now(),
    };
    repo.record(record);
  }
  return service;
}

const currentMonthPrefix = currentWeekMonday().slice(0, 7);

/** A current-month Monday distinct from the current week (one week earlier, else later). */
function otherCurrentMonthWeekStart(): string {
  const current = new Date(`${currentWeekMonday()}T00:00:00.000Z`);
  const earlier = new Date(current);
  earlier.setUTCDate(current.getUTCDate() - 7);
  if (earlier.toISOString().slice(0, 7) === currentMonthPrefix) {
    return earlier.toISOString().slice(0, 10);
  }
  const later = new Date(current);
  later.setUTCDate(current.getUTCDate() + 7);
  return later.toISOString().slice(0, 10);
}

/** A weekStart two calendar months back — guaranteed different YYYY-MM. */
function priorMonthWeekStart(): string {
  const current = new Date(`${currentWeekMonday()}T00:00:00.000Z`);
  const shifted = new Date(current);
  shifted.setUTCMonth(current.getUTCMonth() - 2);
  return shifted.toISOString().slice(0, 10);
}

describe("SavingsService.getSummary", () => {
  test("thisWeek is the record whose weekStart equals the current week Monday", async () => {
    const service = serviceWith([
      { weekStart: currentWeekMonday(), savedAmount: 420, totalSalePrice: 1000, totalRegularPrice: 1420 },
      { weekStart: priorMonthWeekStart(), savedAmount: 500, totalSalePrice: 1000, totalRegularPrice: 1500 },
    ]);

    const summary = await service.getSummary();

    expect(summary.thisWeek).not.toBeNull();
    expect(summary.thisWeek!.weekStart).toBe(currentWeekMonday());
    expect(summary.thisWeek!.totalSalePrice).toBe(1000);
    expect(summary.thisWeek!.totalRegularPrice).toBe(1420);
    expect(summary.thisWeek!.savedAmount).toBe(420);
  });

  test("month-to-date sums only current-month weeks (prior-month excluded — month-filter anchor)", async () => {
    const service = serviceWith([
      { weekStart: currentWeekMonday(), savedAmount: 840, totalSalePrice: 2000, totalRegularPrice: 2840 },
      { weekStart: otherCurrentMonthWeekStart(), savedAmount: 1120, totalSalePrice: 3000, totalRegularPrice: 4120 },
      { weekStart: priorMonthWeekStart(), savedAmount: 500, totalSalePrice: 1000, totalRegularPrice: 1500 },
    ]);

    const summary = await service.getSummary();

    expect(summary.monthToDateCents).toBe(1960); // 840 + 1120, NOT 2460
  });

  test("month-to-date excludes current-month weeks with totalRegularPrice===0 (regular-filter anchor)", async () => {
    const service = serviceWith([
      { weekStart: currentWeekMonday(), savedAmount: 700, totalSalePrice: 1500, totalRegularPrice: 2200 },
      { weekStart: otherCurrentMonthWeekStart(), savedAmount: 0, totalSalePrice: 900, totalRegularPrice: 0 },
    ]);

    const summary = await service.getSummary();

    expect(summary.monthToDateCents).toBe(700); // unavailable week excluded
  });

  test("a week with totalRegularPrice===0 is flagged in unavailableWeekStarts", async () => {
    const unavailableWeek = otherCurrentMonthWeekStart();
    const service = serviceWith([
      { weekStart: currentWeekMonday(), savedAmount: 700, totalSalePrice: 1500, totalRegularPrice: 2200 },
      { weekStart: unavailableWeek, savedAmount: 0, totalSalePrice: 900, totalRegularPrice: 0 },
    ]);

    const summary = await service.getSummary();

    expect(summary.unavailableWeekStarts).toContain(unavailableWeek);
    expect(summary.unavailableWeekStarts).not.toContain(currentWeekMonday());
  });

  test("property: monthToDateCents = sum of savedAmount over current-month AND regular!==0 records only", async () => {
    const monthDay = fc.integer({ min: 1, max: 28 }).map((d) => `${currentMonthPrefix}-${String(d).padStart(2, "0")}`);
    const priorWeek = priorMonthWeekStart();
    const recordArb = fc.record({
      weekStart: fc.oneof(monthDay, fc.constant(priorWeek)),
      savedAmount: fc.integer({ min: 0, max: 5000 }),
      totalSalePrice: fc.integer({ min: 0, max: 5000 }),
      totalRegularPrice: fc.integer({ min: 0, max: 10000 }),
    });

    await fc.assert(
      fc.asyncProperty(fc.array(recordArb, { maxLength: 15 }), async (seeds) => {
        const service = serviceWith(seeds);
        const summary = await service.getSummary();

        const expected = seeds
          .filter((s) => s.weekStart.slice(0, 7) === currentMonthPrefix && s.totalRegularPrice !== 0)
          .reduce((sum, s) => sum + s.savedAmount, 0);

        expect(summary.monthToDateCents).toBe(expected);

        const expectedUnavailable = seeds
          .filter((s) => s.totalRegularPrice === 0)
          .map((s) => s.weekStart);
        for (const ws of expectedUnavailable) {
          expect(summary.unavailableWeekStarts).toContain(ws);
        }
      }),
      { numRuns: 50 },
    );
  });

  test("getHistory remains intact — returns all records DESC by weekStart", async () => {
    const service = serviceWith([
      { weekStart: currentWeekMonday(), savedAmount: 700, totalSalePrice: 1500, totalRegularPrice: 2200 },
      { weekStart: priorMonthWeekStart(), savedAmount: 500, totalSalePrice: 1000, totalRegularPrice: 1500 },
    ]);

    const history = await service.getHistory();

    expect(history).toHaveLength(2);
    expect(history[0].weekStart >= history[1].weekStart).toBe(true);
  });
});
