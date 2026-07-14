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

export const __SCAFFOLD__ = true as const;

export class PlanHandler {
  constructor(private readonly planService: unknown) {}

  async handleGetPlan(request: Request): Promise<Response> {
    throw new Error("Not yet implemented — RED scaffold");
  }

  async handlePostGenerate(request: Request): Promise<Response> {
    throw new Error("Not yet implemented — RED scaffold");
  }
}
