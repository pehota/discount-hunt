/**
 * Shared Kernel — current-week boundary helper.
 *
 * currentWeekMonday() is the single source of truth for "which ISO week are we in".
 * Consumed by: Discount dashboard (GET /) and GeneratePlan (plan-service), which must
 * agree on the week boundary so the feed and the plan describe the same week.
 *
 * Contract shape: pure-function / return-only.
 * Universe: the ambient clock only; no side effects.
 */

import type { WeekStart } from "./types.ts";

/**
 * Returns the ISO date string ("YYYY-MM-DD") for the Monday of the current UTC week.
 * Sunday (day=0) rolls back 6 days; other days offset by (1 - day).
 */
export function currentWeekMonday(): WeekStart {
  const now = new Date();
  const dayOfWeek = now.getUTCDay(); // 0=Sun … 6=Sat
  const offsetToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  const monday = new Date(now);
  monday.setUTCDate(now.getUTCDate() + offsetToMonday);
  return monday.toISOString().slice(0, 10); // "YYYY-MM-DD"
}

const DAYS_MONDAY_TO_SUNDAY = 6;

/**
 * Returns the ISO date string ("YYYY-MM-DD") for the Sunday (end) of the current
 * UTC week — Monday + 6 days. Single source of truth for "end of the current week",
 * used by weekly-catalogue fetchers to stamp validUntil.
 */
export function currentWeekSunday(): WeekStart {
  const sunday = new Date(`${currentWeekMonday()}T00:00:00Z`);
  sunday.setUTCDate(sunday.getUTCDate() + DAYS_MONDAY_TO_SUNDAY);
  return sunday.toISOString().slice(0, 10); // "YYYY-MM-DD"
}
