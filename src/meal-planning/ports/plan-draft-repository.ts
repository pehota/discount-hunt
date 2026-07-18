/**
 * PlanDraftRepository — driven port (RED scaffold, meal-plan-engine ADR-007).
 *
 * Server-side draft state: a single-user throwaway draft singleton in SQLite (mirrors the
 * user_settings singleton pattern). Survives the generate -> regenerate -> Save gap. A draft is
 * NOT the saved plan — persisting a draft never touches meal_plans / savings_log until saveDraft.
 * v2 (S05) extends the draft Meal with per-meal `accepted`; v1 does not.
 */

import type { Meal } from "../../shared/types.ts";

/** The throwaway draft aggregate (one per user; overwritten on regenerate; dropped on discard). */
export interface PlanDraft {
  readonly weekStart: string;
  readonly meals: readonly Meal[];
  readonly source: "feed" | "list";
}

export interface PlanDraftRepository {
  /** Read the current draft, or null if none exists. */
  getDraft(): PlanDraft | null;
  /** Overwrite the draft singleton (generate / regenerate). */
  saveDraft(draft: PlanDraft): void;
  /** Drop the draft (discard, or after it is committed to a saved plan). */
  clearDraft(): void;
}
