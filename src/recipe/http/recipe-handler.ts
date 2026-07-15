/**
 * RecipeHandler — primary (driving) HTTP adapter for the Recipe Matching context.
 *
 * Route: GET /plan/{meal_id}   (meal_id = "{day}-{slot}", e.g. "1-lunch")
 *
 * Flow (design §7):
 *   1. Parse meal_id on the FIRST hyphen → day (int) + slot (rest). Slots
 *      (lunch/dinner) contain no hyphen, so the first-hyphen split is unambiguous.
 *   2. Load the CURRENT week's plan READ-ONLY (planService.getCurrentWeekPlan) —
 *      never regenerate/save. No plan, or no meal matching day+slot → 404 (not 500),
 *      with a "Back to meal plan" link in the body.
 *   3. Resolve the recipe via recipeService.getRecipeForMeal(meal.name).
 *   4. Render the detail view via renderPage.
 *
 * Security (design §1 / §7): ALL interpolated recipe text (name, ingredients, steps,
 * source URL) is escaped via escapeHtml — Chefkoch data is untrusted scraped input.
 * The external link uses rel="noopener".
 *
 * Scope (step 08-03): detail render + routing + 404 + XSS escaping. Ingredient↔discount
 * highlighting (08-04), no-match / dead-source fallbacks (08-05), and plan-meal links
 * (08-06) are NOT implemented here.
 */

import type { PlanService } from "../../meal-planning/plan-service.ts";
import type { Meal } from "../../shared/types.ts";
import type { RecipeService } from "../recipe-service.ts";
import type { ResolvedRecipe } from "../recipe-service.ts";
import { escapeHtml } from "../../shared/html.ts";
import { renderPage } from "../../shared/layout.ts";

const BACK_LINK = `<a href="/plan">Back to meal plan</a>`;

function htmlResponse(html: string, status: number): Response {
  return new Response(html, {
    status,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function renderNotFound(): string {
  const body = `<h1>Recipe not found</h1>
  <p>That meal is not part of your current plan.</p>
  <p>${BACK_LINK}</p>`;
  return renderPage({ title: "Recipe not found", activeNav: "plan", body });
}

function renderIngredients(ingredients: string[]): string {
  const rows = ingredients
    .map((ingredient) => `<li>${escapeHtml(ingredient)}</li>`)
    .join("");
  return `<ul class="recipe-ingredients">${rows}</ul>`;
}

function renderSteps(steps: string[]): string {
  const rows = steps.map((step) => `<li>${escapeHtml(step)}</li>`).join("");
  return `<ol class="recipe-steps">${rows}</ol>`;
}

function renderRecipeDetail(recipe: ResolvedRecipe): string {
  const body = `<h1>${escapeHtml(recipe.name)}</h1>
  <h2>Ingredients</h2>
  ${renderIngredients(recipe.ingredients)}
  <h2>Preparation</h2>
  ${renderSteps(recipe.steps)}
  <p><a href="${escapeHtml(recipe.sourceUrl)}" target="_blank" rel="noopener">Open original recipe</a></p>
  <p>${BACK_LINK}</p>`;
  return renderPage({ title: recipe.name, activeNav: "plan", body });
}

export class RecipeHandler {
  constructor(
    private readonly planService: PlanService,
    private readonly recipeService: RecipeService,
  ) {}

  async handleGet(_request: Request, mealId: string): Promise<Response> {
    const meal = this.findMeal(mealId);
    if (meal === null) {
      return htmlResponse(renderNotFound(), 404);
    }

    const recipe = await this.recipeService.getRecipeForMeal(meal.name);
    return htmlResponse(renderRecipeDetail(recipe!), 200);
  }

  /** Locate the meal for meal_id in the current-week plan, or null if absent. */
  private findMeal(mealId: string): Meal | null {
    const hyphenIndex = mealId.indexOf("-");
    if (hyphenIndex < 0) {
      return null;
    }
    const day = Number.parseInt(mealId.slice(0, hyphenIndex), 10);
    const slot = mealId.slice(hyphenIndex + 1);

    const plan = this.planService.getCurrentWeekPlan();
    if (plan === null) {
      return null;
    }
    return plan.meals.find((meal) => meal.day === day && meal.slot === slot) ?? null;
  }
}
