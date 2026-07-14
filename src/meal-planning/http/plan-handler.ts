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
import type { MealPlan } from "../adapters/sqlite-meal-plan-repository.ts";

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
 * Restriction-filtered empty state: a restriction (!== "none") removed every
 * compatible item. Steer the user to relax their dietary restriction.
 */
function renderRestrictionFilteredHtml(plan: MealPlan): string {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>Meal Plan</title></head>
<body>
  <h1>Meal Plan — Week of ${plan.weekStart}</h1>
  <p class="empty-plan-warning">No compatible meals found with your current restrictions</p>
  <p><a href="/settings">Change your dietary restriction</a></p>
</body>
</html>`;
}

/**
 * No-data empty state: the discount DB is empty (fresh install / failed scrape).
 * Steering a no-data user to change dietary settings is the wrong contract — instead
 * tell them to check back after the next catalogue update. No /settings steer.
 */
function renderNoDataHtml(plan: MealPlan): string {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>Meal Plan</title></head>
<body>
  <h1>Meal Plan — Week of ${plan.weekStart}</h1>
  <p class="no-discounts-warning">No discounts available this week — please check back after the next catalogue update.</p>
</body>
</html>`;
}

function renderPlanHtml(plan: MealPlan): string {
  if (hasNoCompatibleItems(plan)) {
    // Discriminate no-data (dietaryFilter "none") from restriction-filtered.
    return plan.dietaryFilter === "none"
      ? renderNoDataHtml(plan)
      : renderRestrictionFilteredHtml(plan);
  }
  const mealRows = plan.meals
    .map((meal) =>
      `<tr data-meal-slot="${meal.slot}">` +
      `<td>Day ${meal.day} (${DAY_LABELS[meal.day]})</td>` +
      `<td>${capitalizeFirst(meal.slot)}</td>` +
      `<td>${meal.name}</td>` +
      `</tr>`
    )
    .join("");

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>Meal Plan</title></head>
<body>
  <h1>Meal Plan — Week of ${plan.weekStart}</h1>
  <p>
    Estimated savings:
    <span data-estimated-savings="${plan.estimatedSavings}">${formatEuros(plan.estimatedSavings)}</span>
  </p>
  <p>Regular price total: ${formatEuros(plan.totalRegularPrice)}</p>
  <p>Sale price total: ${formatEuros(plan.totalSalePrice)}</p>
  <table>
    <thead><tr><th>Day</th><th>Slot</th><th>Meal</th></tr></thead>
    <tbody>${mealRows}</tbody>
  </table>
</body>
</html>`;
}

export class PlanHandler {
  constructor(private readonly planService: PlanService) {}

  async handleGetPlan(request: Request): Promise<Response> {
    const plan = await this.planService.getOrGenerateCurrentWeekPlan();
    const html = renderPlanHtml(plan);
    return new Response(html, {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }

  async handlePostGenerate(_request: Request): Promise<Response> {
    await this.planService.getOrGenerateCurrentWeekPlan();
    return Response.redirect("/plan", 303);
  }
}
