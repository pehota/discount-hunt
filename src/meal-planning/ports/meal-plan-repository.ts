/**
 * MealPlanRepository — driven port for the saved meal-plan aggregate.
 *
 * Extends the adapter's command surface (save / deleteByWeek / findByWeek) with the
 * archive READ surface. TECH-06: replacing a saved plan archives the previous plan into
 * meal_plan_history rather than deleting it; listArchivedPlans() exposes that archive as
 * an observable read (GET /plan/archive) without leaking internal table shape.
 *
 * WHY-NEW-FILE: src/meal-planning/ports/meal-plan-repository.ts
 *   CLOSEST-EXISTING: src/meal-planning/ports/plan-draft-repository.ts
 *   EXTENSION-COST: plan-draft-repository defines the throwaway-draft singleton port
 *     (getDraft/saveDraft/clearDraft) over plan_drafts — folding the durable saved-plan
 *     archive read into it would conflate two lifecycles (transient draft vs persisted
 *     plan history) in one interface.
 *   PARALLEL-RATIONALE: the two ports have incompatible aggregates (PlanDraft vs archived
 *     MealPlan) and different backing tables (plan_drafts vs meal_plan_history) — a consumer
 *     of the archive read must not be forced to depend on the draft mutation surface.
 */

import type { MealPlan } from "../adapters/sqlite-meal-plan-repository.ts";

/** One archived plan: the original saved MealPlan plus when the replace archived it. */
export interface ArchivedMealPlan extends MealPlan {
  /** ms epoch when a replace-on-save archived this previously-saved plan. */
  archivedAt: number;
}

export interface MealPlanRepository {
  /**
   * All archived (previously-saved, then replaced) plans, most-recently-archived first.
   * Each retains its ORIGINAL weekStart + createdAt (archive preserves provenance).
   */
  listArchivedPlans(): ArchivedMealPlan[];
}
