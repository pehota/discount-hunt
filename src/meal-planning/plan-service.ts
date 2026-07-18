/**
 * PlanService — core domain service for the Meal Planning bounded context.
 *
 * Use cases (D37 plan-value pattern):
 *   generatePlan(weekStart, discountItems): MealPlan — pure computation; no DB writes
 *   savePlan(plan): void                            — only impure function; writes meal_plans +
 *                                                     savings_log in ONE SQLite transaction (D23)
 *
 * Invariants:
 *   - estimated_savings = SUM(regularPrice - salePrice) for all discount items
 *   - savePlan writes both meal_plans.estimated_savings and savings_log.saved_amount in same transaction (D23)
 *   - getOrGenerateCurrentWeekPlan: idempotent — returns existing plan if one exists for current week
 *
 * Driven ports: SQLiteMealPlanRepository, DiscountService, SavingsService, DbClient
 */

import { randomUUID } from "node:crypto";
import type { DbClient } from "../shared/db.ts";
import type { WeekStart, Meal, MealSlot, DietaryRestriction } from "../shared/types.ts";
import { currentWeekMonday } from "../shared/week.ts";
import type { DiscountService } from "../discount/discount-service.ts";
import type { StoredDiscountItem } from "../discount/adapters/sqlite-discount-item-repository.ts";
import type { SQLiteMealPlanRepository, MealPlan } from "./adapters/sqlite-meal-plan-repository.ts";
import type { SavingsService } from "../savings/savings-service.ts";
import type { UserPreferencesRepository } from "../preferences/ports/preferences-repository.ts";
import type { PlanDraft, PlanDraftRepository } from "./ports/plan-draft-repository.ts";

const MEAL_SLOTS: MealSlot[] = ['lunch', 'dinner'];
const DAYS_PER_WEEK = 7;
const NO_DISCOUNT_PLACEHOLDER = 'No discount available';

export class PlanService {
  constructor(
    private readonly discountService: DiscountService,
    private readonly mealPlanRepository: SQLiteMealPlanRepository,
    private readonly savingsService: SavingsService,
    private readonly db: DbClient,
    private readonly preferencesRepository?: UserPreferencesRepository,
    // Optional trailing param (PlanService/PlanHandler precedent): production (server.ts)
    // always injects it; when absent, draft use cases are inert and the existing saved-plan
    // path is unchanged byte-for-byte (protects direct-construction tests).
    private readonly planDraftRepository?: PlanDraftRepository,
  ) {}

  /** Pure computation — no DB writes (D37). Snapshots the restriction + budget cap onto the plan. */
  generatePlan(
    weekStart: WeekStart,
    discountItems: StoredDiscountItem[],
    dietaryFilter: DietaryRestriction = "none",
    budgetCapCents: number | null = null,
  ): MealPlan {
    const totalRegularPrice = discountItems.reduce((sum, item) => sum + item.regularPrice, 0);
    const totalSalePrice = discountItems.reduce((sum, item) => sum + item.salePrice, 0);
    const estimatedSavings = totalRegularPrice - totalSalePrice;

    return {
      id: randomUUID(),
      weekStart,
      itemIds: discountItems.map((item) => item.id),
      meals: this.buildMeals(discountItems),
      dietaryFilter,
      budgetCapCents, // snapshotted at generation; frozen for this week's plan (D25)
      totalRegularPrice,
      totalSalePrice,
      estimatedSavings,
      createdAt: Date.now(),
    };
  }

  private buildMeals(discountItems: StoredDiscountItem[]): Meal[] {
    const meals: Meal[] = [];
    for (let day = 1; day <= DAYS_PER_WEEK; day++) {
      MEAL_SLOTS.forEach((slot, slotIdx) => {
        meals.push(this.buildMealSlot(day, slot, slotIdx, discountItems));
      });
    }
    return meals;
  }

  private buildMealSlot(day: number, slot: MealSlot, slotIdx: number, discountItems: StoredDiscountItem[]): Meal {
    if (discountItems.length === 0) {
      return { day, slot, name: NO_DISCOUNT_PLACEHOLDER, discountItemId: null };
    }
    const slotIndex = (day - 1) * MEAL_SLOTS.length + slotIdx;
    const item = discountItems[slotIndex % discountItems.length];
    if (!item) {
      // Unreachable: modulo over a non-empty array always yields a valid index.
      throw new Error("buildMealSlot: index out of range");
    }
    return { day, slot, name: item.name, discountItemId: item.id };
  }

  /**
   * Only impure function (D37).
   * Writes meal_plans AND savings_log in ONE SQLite transaction (D23).
   *
   * drizzle-orm/bun-sqlite uses a synchronous driver — db.transaction() callback
   * is synchronous. Repository methods (save, recordSavings) are therefore sync.
   */
  async savePlan(plan: MealPlan): Promise<void> {
    // drizzle-orm/bun-sqlite uses a synchronous SQLite driver.
    // The repositories share this db reference — all writes in the callback
    // execute inside the same bun:sqlite transaction (connection-scoped).
    // _tx is unused directly; repos call this.db internally.
    this.db.transaction((_tx) => {
      // REPLACE-on-save: wipe any prior plan + savings row for this week FIRST, so a
      // regenerate can never accumulate a second savings_log row or double-count the
      // week's savings. Both deletes + both inserts execute in this single sync
      // bun-sqlite transaction (connection-scoped) — atomic by construction. On the
      // get-or-generate path there is no prior row → both deletes are harmless no-ops.
      this.mealPlanRepository.deleteByWeek(plan.weekStart);
      this.savingsService.deleteByWeek(plan.weekStart);
      this.mealPlanRepository.save(plan);
      // D23: same cents value written to both tables atomically
      this.savingsService.recordSavings(
        plan.id,
        plan.estimatedSavings,
        plan.totalSalePrice,
        plan.totalRegularPrice,
        plan.itemIds.length,
        plan.weekStart,
      );
    });
  }

  /**
   * Read-only current-week plan lookup — NO generate, NO save (contrast with
   * getOrGenerateCurrentWeekPlan). The recipe detail route (GET /plan/{meal_id})
   * needs to locate an existing meal without mutating any state: resolving a recipe
   * must never trigger plan generation or a savings_log write.
   */
  getCurrentWeekPlan(): MealPlan | null {
    return this.mealPlanRepository.findByWeek(currentWeekMonday());
  }

  /**
   * Read-only lookup of THIS week's live discount items, keyed by their id
   * (StoredDiscountItem.id === Meal.discountItemId). Lets the plan view surface the
   * store + sale price behind each meal without touching the plan snapshot. Restriction
   * "none" so every item a meal could reference is resolvable; a meal whose discountItemId
   * is null or absent from the live feed (frozen plan vs live feed diverging) degrades
   * gracefully at the call site. No writes.
   */
  async getCurrentWeekItemsById(): Promise<Map<string, StoredDiscountItem>> {
    const items = await this.discountService.getWeeklyItems(currentWeekMonday(), "none");
    return new Map(items.map((item) => [item.id, item]));
  }

  /**
   * Generate + persist THIS week's plan from EXACTLY the user-selected discount items
   * (feed checkbox selection). Replaces any existing plan for the week (savePlan is
   * replace-on-save), so regenerating never double-counts savings.
   *
   * Selection is authoritative: items are resolved with restriction "none" so every
   * checked id resolves regardless of the current dietary filter; the filter + budget
   * cap are still snapshotted onto the plan (banner semantics, D25) exactly as the
   * get-or-generate path reads them.
   *
   * Returns null WITHOUT any DB write when the selection resolves to an empty subset —
   * the caller must render a no-selection state and MUST NOT persist (an empty selection
   * must never wipe an existing good plan). Feed order is preserved in the subset.
   */
  async generateFromSelection(selectedIds: string[]): Promise<MealPlan | null> {
    if (selectedIds.length === 0) return null;

    const weekStart = currentWeekMonday();
    const selected = new Set(selectedIds);
    const items = await this.discountService.getWeeklyItems(weekStart, "none");
    const subset = items.filter((item) => selected.has(item.id)); // preserves feed order
    if (subset.length === 0) return null;

    const preferences = this.preferencesRepository?.get();
    const restriction = preferences?.dietaryRestriction ?? "none";
    const budgetCapCents = preferences?.budgetCapCents ?? null;
    const plan = this.generatePlan(weekStart, subset, restriction, budgetCapCents);
    await this.savePlan(plan);
    return plan;
  }

  /**
   * SHELL use case (D38): generate a THROWAWAY draft for this week and store it ONLY in the
   * draft slot (PlanDraftRepository). NEVER touches meal_plans / savings_log — a generated draft
   * writes no savings row until the user explicitly Saves it (S01a). The pure generatePlan core
   * is reused verbatim to build the meals; only the draft slot is a bounded side effect.
   */
  async generateDraft(): Promise<PlanDraft> {
    const weekStart = currentWeekMonday();
    const preferences = this.preferencesRepository?.get();
    const restriction = preferences?.dietaryRestriction ?? "none";
    const budgetCapCents = preferences?.budgetCapCents ?? null;
    const items = await this.discountService.getWeeklyItems(weekStart, restriction);
    const plan = this.generatePlan(weekStart, items, restriction, budgetCapCents);
    const draft: PlanDraft = { weekStart, meals: plan.meals, source: "feed" };
    this.planDraftRepository?.saveDraft(draft);
    return draft;
  }

  /**
   * SHELL use case (D38): rebuild the WHOLE draft from scratch and overwrite the draft slot
   * (bounded-change over the draft slot only). Like generateDraft, NEVER touches meal_plans /
   * savings_log — regenerating persists nothing until the user Saves (S01a). Whole-draft rebuild
   * only; per-meal lock (S05) is DEFERRED, out of v1 scope. Delegates to generateDraft: at v1 a
   * regenerate IS a fresh whole-draft generate over the draft slot (single source of truth).
   */
  async regenerateDraft(): Promise<PlanDraft> {
    return this.generateDraft();
  }

  /** Read-only: the current unsaved draft, or null when none exists (no draft repo → null). */
  getCurrentDraft(): PlanDraft | null {
    return this.planDraftRepository?.getDraft() ?? null;
  }

  /**
   * SHELL use case (D38): DROP the current draft (S01a Discard). Clears the draft slot ONLY —
   * NEVER touches meal_plans / savings_log. After discard, GET /plan naturally falls back to the
   * last SAVED plan (or the empty state when none exists), because the draft short-circuit is gone.
   * Inert when no draft repo is injected (mirrors the other draft use cases).
   */
  discardDraft(): void {
    this.planDraftRepository?.clearDraft();
  }

  /**
   * SHELL use case (D38): COMMIT the current draft to this week's saved plan (S01a Save).
   * Reads the draft slot, projects it into a full MealPlan, then delegates persistence to the
   * SHIPPED savePlan (replace-on-save; writes meal_plans + savings_log atomically with the
   * double-count guard) — the savings/persistence logic is REUSED VERBATIM, never re-implemented.
   * After persisting, clears the draft slot so GET /plan shows the saved plan, not the draft banner.
   *
   * The plan's savings math + id + snapshot (dietary filter, budget cap) come from the pure
   * generatePlan core over the draft's referenced items; the meals are carried through from the
   * draft verbatim ([...draft.meals]) so the SAVED plan is exactly the draft the user reviewed —
   * faithful to "save persists IT", not a fresh regenerate.
   *
   * Returns the persisted MealPlan, or null WITHOUT any write when no draft exists (nothing to save).
   */
  async saveDraft(): Promise<MealPlan | null> {
    const draft = this.planDraftRepository?.getDraft();
    if (!draft) return null;

    const referencedIds = new Set(
      draft.meals
        .map((meal) => meal.discountItemId)
        .filter((id): id is string => id !== null),
    );
    const items = await this.discountService.getWeeklyItems(draft.weekStart, "none");
    const subset = items.filter((item) => referencedIds.has(item.id));

    const preferences = this.preferencesRepository?.get();
    const restriction = preferences?.dietaryRestriction ?? "none";
    const budgetCapCents = preferences?.budgetCapCents ?? null;

    const generated = this.generatePlan(draft.weekStart, subset, restriction, budgetCapCents);
    // Carry the draft's meals through verbatim: the SAVED plan is exactly what the user reviewed
    // (faithful to "persists it"), while savings totals / id / snapshot come from generatePlan.
    const plan: MealPlan = { ...generated, meals: [...draft.meals] };

    await this.savePlan(plan); // SHIPPED replace-on-save + double-count guard, REUSED verbatim
    this.planDraftRepository?.clearDraft();
    return plan;
  }

  async getOrGenerateCurrentWeekPlan(): Promise<MealPlan> {
    const weekStart = currentWeekMonday();
    const existing = this.mealPlanRepository.findByWeek(weekStart);
    if (existing) return existing;

    const preferences = this.preferencesRepository?.get();
    const restriction = preferences?.dietaryRestriction ?? "none";
    const budgetCapCents = preferences?.budgetCapCents ?? null;
    const items = await this.discountService.getWeeklyItems(weekStart, restriction);
    const plan = this.generatePlan(weekStart, items, restriction, budgetCapCents);
    // Do NOT persist ANY empty plan, regardless of restriction. An empty plan is a transient
    // "couldn't build one" signal, never a durable weekly commitment. Persisting it makes
    // get-or-create return it forever, so compatible discounts arriving later stay hidden and a
    // bogus 0-savings row is written (bug 07-01 / 07-02). Leaving it unsaved makes it non-sticky —
    // the next read re-queries with the current restriction and surfaces newly-arrived items.
    // Non-empty plans ARE persisted: they are durable weekly commitments, frozen until next week
    // (03-08 D2 snapshot immutability). Split is exactly items.length === 0.
    if (items.length > 0) {
      await this.savePlan(plan);
    }
    return plan;
  }
}
