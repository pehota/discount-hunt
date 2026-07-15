/**
 * Composition root — src/server.ts (D35: wire → probe → register routes)
 *
 * Production entry point:
 *   bun run src/server.ts
 *
 * Accepts optional config for test seam:
 *   createServer({ port, dbPath }) — used in acceptance tests to start on a random port
 *   with a test-specific SQLite file.
 *
 * When run directly (not imported), reads TEST_DB_PATH env var (if set) or defaults
 * to ./discount-hunt.db.
 *
 * Wire order (D35):
 *   1. createDb(dbPath) — opens SQLite, enables WAL, runs startup probe
 *   2. Instantiate all adapters (SQLite repos)
 *   3. Instantiate all domain services
 *   4. Instantiate all HTTP handlers
 *   5. Register HTTP routes with Bun.serve
 *   6. Adapters that fail their probe: log health.startup.refused, exit code 1
 */

import { createDb } from "./shared/db.ts";
import type { ServerConfig, ServerHandle } from "./shared/types.ts";
import { SQLiteDiscountItemRepository } from "./discount/adapters/sqlite-discount-item-repository.ts";
import { DiscountService } from "./discount/discount-service.ts";
import { DiscountHandler } from "./discount/http/discount-handler.ts";
import { SQLiteScrapeJobRepository } from "./scraping/adapters/sqlite-scrape-job-repository.ts";
import { SQLiteMealPlanRepository } from "./meal-planning/adapters/sqlite-meal-plan-repository.ts";
import { PlanService } from "./meal-planning/plan-service.ts";
import { PlanHandler } from "./meal-planning/http/plan-handler.ts";
import { SQLiteSavingsRepository } from "./savings/adapters/sqlite-savings-repository.ts";
import { SavingsService } from "./savings/savings-service.ts";
import { SavingsHandler } from "./savings/http/savings-handler.ts";
import { SQLiteUserPreferencesRepository } from "./preferences/adapters/sqlite-user-preferences-repository.ts";
import { PreferencesService } from "./preferences/preferences-service.ts";
import { SettingsHandler } from "./preferences/http/settings-handler.ts";
import { SQLiteRecipeRepository } from "./recipe/adapters/sqlite-recipe-repository.ts";
import { ChefkochRecipeSource } from "./recipe/adapters/chefkoch-recipe-source.ts";
import { RecipeService } from "./recipe/recipe-service.ts";
import type { RecipeSource } from "./recipe/ports/recipe-source.ts";

export type { ServerConfig, ServerHandle };

/**
 * Creates and starts the HTTP server with the production composition root.
 * Returns a handle with stop() for graceful shutdown (used in tests).
 *
 * Wire order (D35):
 *   1. createDb(dbPath)
 *   2. Instantiate repositories
 *   3. Instantiate services
 *   4. Instantiate handlers
 *   5. Register routes with Bun.serve
 *   6. Return { stop }
 */
export async function createServer(
  config: ServerConfig & { recipeSource?: RecipeSource },
): Promise<ServerHandle> {
  // 1. Database
  const db = createDb(config.dbPath);

  // 2. Repositories
  const discountItemRepo = new SQLiteDiscountItemRepository(db);
  const mealPlanRepo = new SQLiteMealPlanRepository(db);
  const savingsRepo = new SQLiteSavingsRepository(db);
  const scrapeJobRepo = new SQLiteScrapeJobRepository(db);
  const preferencesRepo = new SQLiteUserPreferencesRepository(db);
  const recipeRepo = new SQLiteRecipeRepository(db);

  // 3. Services
  const discountService = new DiscountService(discountItemRepo);
  const savingsService = new SavingsService(savingsRepo);
  const planService = new PlanService(discountService, mealPlanRepo, savingsService, db, preferencesRepo);
  const preferencesService = new PreferencesService(preferencesRepo);
  // Recipe lookup: prod default hits Chefkoch; tests inject a FakeRecipeSource.
  // Wired now; the GET /plan/{meal_id} handler + route arrive in 08-03.
  const recipeService = new RecipeService(recipeRepo, config.recipeSource ?? new ChefkochRecipeSource());
  void recipeService;

  // 4. Handlers
  const discountHandler = new DiscountHandler(discountService, scrapeJobRepo, preferencesRepo);
  const planHandler = new PlanHandler(planService);
  const savingsHandler = new SavingsHandler(savingsService);
  const settingsHandler = new SettingsHandler(preferencesService);

  // 5. Routes
  const server = Bun.serve({
    port: config.port,
    async fetch(request: Request): Promise<Response> {
      const url = new URL(request.url);
      const method = request.method;

      if (method === "GET" && url.pathname === "/") {
        return discountHandler.handleGet(request);
      }
      if (method === "POST" && url.pathname === "/plan/generate") {
        return planHandler.handlePostGenerate(request);
      }
      if (method === "GET" && url.pathname === "/plan") {
        return planHandler.handleGetPlan(request);
      }
      if (method === "GET" && url.pathname === "/savings") {
        return savingsHandler.handleGet(request);
      }
      if (method === "GET" && url.pathname === "/settings") {
        return settingsHandler.handleGet(request);
      }
      if (method === "POST" && url.pathname === "/settings") {
        return settingsHandler.handlePost(request);
      }

      return new Response("Not Found", { status: 404 });
    },
  });

  // 6. Handle
  return { stop: () => server.stop() };
}

// Direct invocation (cron / systemd)
if (import.meta.main) {
  const port = Number(process.env["PORT"] ?? 3000);
  const dbPath = process.env["TEST_DB_PATH"] ?? "./discount-hunt.db";
  createServer({ port, dbPath }).catch((err) => {
    console.error("health.startup.refused", err);
    process.exit(1);
  });
}
