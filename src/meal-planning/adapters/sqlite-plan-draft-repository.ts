/**
 * SQLitePlanDraftRepository — secondary adapter for PlanDraftRepository (ADR-007).
 *
 * Table: plan_drafts (see src/shared/schema.ts)
 * Single-row singleton: fixed PK user_id='dimitar' (mirrors user_settings D9) + INSERT ...
 * ON CONFLICT DO UPDATE, so the table structurally holds at most one draft row. The draft is
 * throwaway — writing it NEVER touches meal_plans / savings_log (that is savePlan's job).
 *
 * Substrate probe (Principle 13): inherits the shared WAL write-read-delete startup probe in
 * db.ts — no new probe here (D35 wire→probe→use covers the shared client).
 */

import { sql } from "drizzle-orm";
import type { DbClient } from "../../shared/db.ts";
import type { Meal } from "../../shared/types.ts";
import type { PlanDraft, PlanDraftRepository } from "../ports/plan-draft-repository.ts";

const SINGLETON_USER_ID = "dimitar";

export class SQLitePlanDraftRepository implements PlanDraftRepository {
  constructor(private readonly db: DbClient) {}

  getDraft(): PlanDraft | null {
    // drizzle-orm/bun-sqlite .get() returns a positional tuple (or undefined).
    // Tuple order MUST match the SELECT list below, column-for-column.
    const row = this.db.get<[string, string, string]>(
      sql`SELECT week_start, meals, source FROM plan_drafts WHERE user_id = ${SINGLETON_USER_ID}`,
    );
    if (!row) return null;
    return {
      weekStart: row[0],
      meals: JSON.parse(row[1]) as Meal[],
      source: row[2] as PlanDraft["source"],
    };
  }

  saveDraft(draft: PlanDraft): void {
    this.db.run(sql`
      INSERT INTO plan_drafts (user_id, week_start, meals, source, updated_at)
      VALUES (${SINGLETON_USER_ID}, ${draft.weekStart}, ${JSON.stringify(draft.meals)}, ${draft.source}, ${Date.now()})
      ON CONFLICT(user_id) DO UPDATE SET
        week_start = excluded.week_start,
        meals = excluded.meals,
        source = excluded.source,
        updated_at = excluded.updated_at
    `);
  }

  clearDraft(): void {
    this.db.run(sql`DELETE FROM plan_drafts WHERE user_id = ${SINGLETON_USER_ID}`);
  }
}
