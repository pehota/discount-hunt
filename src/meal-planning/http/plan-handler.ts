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

function formatEuros(cents: number): string {
  return `€${(cents / 100).toFixed(2)}`;
}

function renderPlanHtml(plan: MealPlan): string {
  const itemList = plan.itemIds
    .map((id) => `<li>${id}</li>`)
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
  <ul>${itemList}</ul>
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
