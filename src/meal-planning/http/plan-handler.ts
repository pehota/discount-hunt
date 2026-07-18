/**
 * PlanHandler — primary HTTP adapter for Meal Planning routes.
 *
 * Routes:
 *   GET  /plan          — renders current week's meal plan HTML
 *   POST /plan/generate — triggers GeneratePlan use case; redirects to /plan
 *
 * Estimated savings must appear in the plan view (D23, shared-artifacts-registry).
 *
 * AT CONTRACT: handleGetPlan must render estimated_savings as:
 *   <span data-estimated-savings="{cents}">€{euros}</span>  (cents = integer, e.g. 290 for €2.90)
 *   The walking-skeleton AT extracts data-estimated-savings to assert D23 structurally.
 */

import type { PlanService } from "../plan-service.ts";
import type { PlanDraft } from "../ports/plan-draft-repository.ts";
import type { MealPlanRepository, ArchivedMealPlan } from "../ports/meal-plan-repository.ts";
import type { MealPlan } from "../adapters/sqlite-meal-plan-repository.ts";
import type { MealSlot } from "../../shared/types.ts";
import type { StoredDiscountItem } from "../../discount/adapters/sqlite-discount-item-repository.ts";
import type { UserPreferencesRepository } from "../../preferences/ports/preferences-repository.ts";
import type { ShoppingListService } from "../../shopping-list/shopping-list-service.ts";
import { escapeHtml } from "../../shared/html.ts";
import { renderPage } from "../../shared/layout.ts";
import { currentWeekMonday } from "../../shared/week.ts";

/** Per-meal store + sale price, resolved from the live feed; null when unavailable. */
type MealSource = { store: string; salePrice: number } | null;

const DAY_LABELS: Record<number, string> = {
  1: 'Mon', 2: 'Tue', 3: 'Wed', 4: 'Thu', 5: 'Fri', 6: 'Sat', 7: 'Sun',
};

function formatEuros(cents: number): string {
  return `€${(cents / 100).toFixed(2)}`;
}

function capitalizeFirst(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/** True when no meal references a real discount item (restriction filtered them all out). */
function hasNoCompatibleItems(plan: MealPlan): boolean {
  return plan.meals.every((meal) => meal.discountItemId === null);
}

/**
 * True when the plan's SNAPSHOTTED cap is set and the sale total exceeds it.
 * Reads plan.budgetCapCents (frozen at generation), never the live setting — so raising
 * the cap after generation does not clear the banner (snapshot immutability, D25).
 * Loose `!=` covers both null and undefined.
 */
function isOverBudget(plan: MealPlan): boolean {
  return plan.budgetCapCents != null && plan.totalSalePrice > plan.budgetCapCents;
}

/** Over-budget warning banner, emitted only in the populated-plan branch. */
function renderOverBudgetBanner(plan: MealPlan): string {
  if (!isOverBudget(plan)) return "";
  return `<p class="over-budget-warning" data-over-budget>This plan is over your weekly budget of ${formatEuros(plan.budgetCapCents!)}.</p>`;
}

/**
 * Restriction-filtered empty state: a restriction (!== "none") removed every
 * compatible item. Steer the user to relax their dietary restriction.
 */
function renderRestrictionFilteredHtml(plan: MealPlan, listCount: number): string {
  const body = `<h1>Meal Plan — Week of ${plan.weekStart}</h1>
  <p class="empty-plan-warning">No compatible meals found with your current restrictions</p>
  <p><a href="/settings">Change your dietary restriction</a></p>`;
  return renderPage({ title: "Meal Plan", activeNav: "plan", body, listCount });
}

/**
 * No-data empty state: the discount DB is empty (fresh install / failed scrape).
 * Steering a no-data user to change dietary settings is the wrong contract — instead
 * tell them to check back after the next catalogue update. No /settings steer.
 */
function renderNoDataHtml(plan: MealPlan, listCount: number): string {
  const body = `<h1>Meal Plan — Week of ${plan.weekStart}</h1>
  <p class="no-discounts-warning">No discounts available this week — please check back after the next catalogue update.</p>`;
  return renderPage({ title: "Meal Plan", activeNav: "plan", body, listCount });
}

/**
 * Plan-free no-data empty state for the current week — used on the discard path when no plan is
 * saved yet. Reuses renderNoDataHtml's copy over a synthesized empty current-week plan (there is
 * no saved plan to read a weekStart from), so discarding into an empty week shows the same
 * "check back after the next catalogue update" state a fresh GET /plan would.
 */
function renderNoDataForWeek(listCount: number): string {
  const emptyWeekPlan = { weekStart: currentWeekMonday() } as MealPlan;
  return renderNoDataHtml(emptyWeekPlan, listCount);
}

/**
 * Meal-name cell (12-04): a recipe LINK only when the meal's slot is in scope
 * (slot ∈ prefs.mealTypes); otherwise the plain escaped name without an <a>.
 * data-meal-slot + every other marker are unchanged.
 */
function renderMealNameCell(meal: MealPlan["meals"][number], scopedSlots: MealSlot[]): string {
  const escapedName = escapeHtml(meal.name);
  if (!scopedSlots.includes(meal.slot)) {
    return `<td data-label="Meal">${escapedName}</td>`;
  }
  return `<td data-label="Meal"><a href="/plan/${meal.day}-${meal.slot}">${escapedName}</a></td>`;
}

/** Store cell — degrades to an em dash when the meal has no resolvable discount item. */
function renderStoreCell(source: MealSource): string {
  const text = source === null ? "—" : escapeHtml(source.store);
  return `<td data-label="Store">${text}</td>`;
}

/** Price cell — the sale price driving this meal; em dash when unavailable. */
function renderPriceCell(source: MealSource): string {
  if (source === null) return `<td data-label="Price">—</td>`;
  return `<td data-label="Price"><span class="sale-price">${formatEuros(source.salePrice)}</span></td>`;
}

/** Resolve the store + sale price behind a meal from the live-feed item map. */
function mealSource(
  meal: MealPlan["meals"][number],
  itemsById: Map<string, StoredDiscountItem>,
): MealSource {
  if (meal.discountItemId === null) return null;
  const item = itemsById.get(meal.discountItemId);
  return item ? { store: item.store, salePrice: item.salePrice } : null;
}

function renderSavingsHero(plan: MealPlan): string {
  const pct = plan.totalRegularPrice > 0
    ? Math.round((plan.estimatedSavings / plan.totalRegularPrice) * 100)
    : 0;
  const pctChip = pct > 0 ? `<span class="hero-pct">−${pct}%</span>` : "";
  return `<section class="savings-hero plan-hero">
    <p class="hero-label">Estimated savings</p>
    <span class="hero-amount" data-estimated-savings="${plan.estimatedSavings}">${formatEuros(plan.estimatedSavings)}</span>
    <p class="hero-sub">paid ${formatEuros(plan.totalSalePrice)} of ${formatEuros(plan.totalRegularPrice)}</p>
    ${pctChip}
  </section>`;
}

/** Unsaved-draft banner (S01a) — rendered only when the plan view shows a throwaway draft. */
function renderDraftBanner(): string {
  return `<p class="draft-banner" data-unsaved-draft>Unsaved draft — Save it to keep it, or Discard.</p>`;
}

function renderPlanHtml(
  plan: MealPlan,
  scopedSlots: MealSlot[],
  itemsById: Map<string, StoredDiscountItem>,
  listCount: number,
  isDraft = false,
): string {
  if (hasNoCompatibleItems(plan)) {
    // Discriminate no-data (dietaryFilter "none") from restriction-filtered.
    return plan.dietaryFilter === "none"
      ? renderNoDataHtml(plan, listCount)
      : renderRestrictionFilteredHtml(plan, listCount);
  }
  const mealRows = plan.meals
    .map((meal) => {
      const source = mealSource(meal, itemsById);
      return `<tr data-meal-slot="${meal.slot}">` +
        `<td data-label="Day">Day ${meal.day} (${DAY_LABELS[meal.day]})</td>` +
        `<td data-label="Slot"><span class="slot-badge">${capitalizeFirst(meal.slot)}</span></td>` +
        renderMealNameCell(meal, scopedSlots) +
        renderStoreCell(source) +
        renderPriceCell(source) +
        `</tr>`;
    })
    .join("");

  const body = `<h1>Meal Plan — Week of ${plan.weekStart}</h1>
  ${isDraft ? renderDraftBanner() : ""}
  ${renderOverBudgetBanner(plan)}
  ${renderSavingsHero(plan)}
  <table>
    <thead><tr><th>Day</th><th>Slot</th><th>Meal</th><th>Store</th><th>Price</th></tr></thead>
    <tbody>${mealRows}</tbody>
  </table>`;
  return renderPage({ title: "Meal Plan", activeNav: "plan", body, listCount });
}

/**
 * Inline no-selection state for POST /plan/generate when the user submitted zero
 * products. NOT a redirect to /plan (that would auto-generate from ALL items). Steers
 * the user back to the feed to pick at least one product and generate again.
 */
function renderNoSelectionHtml(listCount: number): string {
  const body = `<h1>Meal Plan</h1>
  <p class="empty-plan-warning">No products selected — pick at least one and generate again.</p>
  <p><a href="/">Back to the discount feed</a></p>`;
  return renderPage({ title: "Meal Plan", activeNav: "plan", body, listCount });
}

/**
 * Add-to-list prompt (S01a D4) — rendered right after a draft is saved. Asks whether to add the
 * saved plan's discounted items to the shopping list. The prompt copy carries a literal apostrophe
 * (NOT html-escaped) so it reads naturally; the ACCEPT action is wired later (05-01).
 */
function renderSavePromptHtml(listCount: number): string {
  const body = `<h1>Plan saved</h1>
  <p class="save-add-to-list-prompt" data-add-to-list-prompt>Add this plan's discounted items to your shopping list?</p>
  <p><a href="/plan">Back to your saved plan</a></p>`;
  return renderPage({ title: "Plan saved", activeNav: "plan", body, listCount });
}

/**
 * Plan-archive read surface (TECH-06, GET /plan/archive). Renders every previously-saved,
 * then-replaced plan as a card carrying the `data-archived-plan` marker, showing its ORIGINAL
 * week + estimated savings (provenance preserved). Separate read surface — the current-week
 * /plan view is unchanged. Empty archive renders a friendly empty state (no markers).
 */
function renderArchiveHtml(archived: ArchivedMealPlan[], listCount: number): string {
  if (archived.length === 0) {
    const emptyBody = `<h1>Plan Archive</h1>
  <p class="empty-archive">No previous plans have been archived yet.</p>`;
    return renderPage({ title: "Plan Archive", activeNav: "plan", body: emptyBody, listCount });
  }
  const cards = archived
    .map((plan) => `<li data-archived-plan class="archived-plan">` +
      `<span class="archived-week">Week of ${escapeHtml(plan.weekStart)}</span> ` +
      `<span class="archived-savings" data-estimated-savings="${plan.estimatedSavings}">${formatEuros(plan.estimatedSavings)}</span>` +
      `</li>`)
    .join("");
  const body = `<h1>Plan Archive</h1>
  <ul class="archived-plans">${cards}</ul>`;
  return renderPage({ title: "Plan Archive", activeNav: "plan", body, listCount });
}

const DEFAULT_MEAL_TYPES: MealSlot[] = ["lunch", "dinner"];

/**
 * Project a throwaway draft into a MealPlan shape so the existing renderPlanHtml can render it
 * (DRY — no parallel draft renderer). Savings totals are derived from the live-feed item map
 * over the DISTINCT items the draft references, so the savings hero reflects the draft, not a
 * stale saved plan. dietaryFilter is left "none" — the draft only reaches this projection when
 * it has compatible meals (an empty draft renders the no-data state, not the banner path).
 */
function draftAsPlan(draft: PlanDraft, itemsById: Map<string, StoredDiscountItem>): MealPlan {
  const referencedIds = [...new Set(
    draft.meals.map((meal) => meal.discountItemId).filter((id): id is string => id !== null),
  )];
  let totalRegularPrice = 0;
  let totalSalePrice = 0;
  for (const id of referencedIds) {
    const item = itemsById.get(id);
    if (!item) continue;
    totalRegularPrice += item.regularPrice;
    totalSalePrice += item.salePrice;
  }
  return {
    id: "draft",
    weekStart: draft.weekStart,
    itemIds: referencedIds,
    meals: [...draft.meals],
    dietaryFilter: "none",
    budgetCapCents: null,
    totalRegularPrice,
    totalSalePrice,
    estimatedSavings: totalRegularPrice - totalSalePrice,
    createdAt: Date.now(),
  };
}

export class PlanHandler {
  constructor(
    private readonly planService: PlanService,
    // Optional to preserve the existing direct-construction contract (plan-handler.test.ts),
    // mirroring the PlanService precedent. Production (server.ts) always injects it; when
    // absent, scope defaults to both slots (prior all-meals-linked behavior).
    private readonly preferencesRepository?: UserPreferencesRepository,
    // Optional trailing param (same precedent): production injects it for the nav badge.
    private readonly shoppingListService?: ShoppingListService,
    // Optional trailing param (same precedent): the archive READ port (TECH-06). Production
    // (server.ts) injects the SQLite repo; when absent, the archive view shows the empty state.
    private readonly mealPlanRepository?: MealPlanRepository,
  ) {}

  async handleGetPlan(request: Request): Promise<Response> {
    // Read the in-scope meal types LIVE (render-time), never from the plan snapshot.
    const scopedSlots = this.preferencesRepository?.get().mealTypes ?? DEFAULT_MEAL_TYPES;
    // Live-feed lookup to surface the store + sale price behind each meal (degrades
    // gracefully per meal when a discount item is missing from the current feed).
    const itemsById = await this.planService.getCurrentWeekItemsById();

    // Draft short-circuit (S01a): when an unsaved draft exists, render IT (with the
    // "Unsaved draft" banner) from draft state and DO NOT call getOrGenerateCurrentWeekPlan
    // — that path would generate + savePlan, writing a savings_log row for a mere draft.
    const draft = this.planService.getCurrentDraft();
    if (draft !== null) {
      const draftPlan = draftAsPlan(draft, itemsById);
      const draftHtml = renderPlanHtml(draftPlan, scopedSlots, itemsById, this.listCount(), true);
      return new Response(draftHtml, {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }

    const plan = await this.planService.getOrGenerateCurrentWeekPlan();
    const html = renderPlanHtml(plan, scopedSlots, itemsById, this.listCount());
    return new Response(html, {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }

  /**
   * GET /plan/archive (TECH-06) — the plan-archive read surface. Lists previously-saved,
   * then-replaced plans (archived, not deleted) as `data-archived-plan` cards. A SEPARATE
   * read surface from the current-week /plan view, which stays unchanged.
   */
  async handleGetArchive(_request: Request): Promise<Response> {
    const archived = this.mealPlanRepository?.listArchivedPlans() ?? [];
    return new Response(renderArchiveHtml(archived, this.listCount()), {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }

  /** Current-week list count for the nav badge; 0 when the service is not injected. */
  private listCount(): number {
    return this.shoppingListService?.count() ?? 0;
  }

  async handlePostGenerate(request: Request): Promise<Response> {
    // Draft path (S01a): ?draft=true generates a THROWAWAY draft (draft slot only, no
    // meal_plans / savings_log write) and redirects to /plan, which renders it with the
    // "Unsaved draft" banner. Short-circuits before any selection parsing / persistence.
    if (new URL(request.url).searchParams.get("draft") === "true") {
      await this.planService.generateDraft();
      return Response.redirect("/plan", 303);
    }

    // Parse the feed's checkbox selection. A bodyless POST (or a non-form body)
    // makes formData() throw — treat that as an empty selection, never a crash.
    let selectedIds: string[] = [];
    try {
      const form = await request.formData();
      selectedIds = form.getAll("itemIds").map(String);
    } catch {
      selectedIds = [];
    }

    // Empty selection: render an inline no-selection state and return 200. Crucially
    // this happens BEFORE any persistence — we must NOT touch savePlan (no delete, no
    // insert), so an existing good plan is preserved. Redirecting to /plan here would
    // re-trigger get-or-generate-from-ALL-items — the exact junk-meal bug this fixes.
    const plan = await this.planService.generateFromSelection(selectedIds);
    if (plan === null) {
      return new Response(renderNoSelectionHtml(this.listCount()), {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }

    return Response.redirect("/plan", 303);
  }

  /**
   * POST /plan/regenerate (S01a) — thin adapter: rebuild the WHOLE draft (draft slot only, no
   * meal_plans / savings_log write) and redirect to /plan, which renders the rebuilt draft with
   * the "Unsaved draft" banner. No business logic here — the SHELL use case owns the bounded change.
   */
  async handlePostRegenerate(_request: Request): Promise<Response> {
    await this.planService.regenerateDraft();
    return Response.redirect("/plan", 303);
  }

  /**
   * POST /plan/save (S01a) — commit the current draft to this week's saved plan (SHELL use case
   * owns replace-on-save + savings persistence + draft clear), then render the add-to-list prompt.
   *
   * Unlike generate/regenerate this does NOT redirect: the response itself carries the D4 prompt
   * HTML (200) so the user is asked, right after saving, whether to add the plan's discounted items
   * to their shopping list. The ACCEPT action is wired later (05-01); here we only render the offer.
   */
  async handlePostSave(_request: Request): Promise<Response> {
    await this.planService.saveDraft();
    return new Response(renderSavePromptHtml(this.listCount()), {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }

  /**
   * POST /plan/discard (S01a) — drop the current draft (SHELL use case clears the draft slot only,
   * no meal_plans / savings_log write), then render the last SAVED plan for the week READ-ONLY.
   *
   * Deliberately does NOT redirect to /plan and does NOT call getOrGenerateCurrentWeekPlan: a
   * discard must never persist. It reads the saved plan via getCurrentWeekPlan (no generate, no
   * save) and, when none exists, renders the no-data empty state — so discarding a draft can never
   * write a savings_log row nor resurrect a plan.
   */
  async handlePostDiscard(_request: Request): Promise<Response> {
    this.planService.discardDraft();
    const scopedSlots = this.preferencesRepository?.get().mealTypes ?? DEFAULT_MEAL_TYPES;
    const itemsById = await this.planService.getCurrentWeekItemsById();
    const saved = this.planService.getCurrentWeekPlan();
    const html = saved === null
      ? renderNoDataForWeek(this.listCount())
      : renderPlanHtml(saved, scopedSlots, itemsById, this.listCount());
    return new Response(html, {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }
}
