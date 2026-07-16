/**
 * Categoriser CLI entry point (one-shot, mirrors scraper-runner).
 *
 * Invocation: bun run src/categorisation/categoriser-runner.ts
 *
 * Environment (test seam — same idiom as scraper-runner):
 *   TEST_DB_PATH — SQLite file path; defaults to ./discount-hunt.db
 *   LLM config (see src/llm/resolve-llm.ts): when a usable LLM is configured the
 *   classifier is wired and classifies every item; otherwise unclassified rows
 *   stay NULL (pending).
 *
 * NULL-only idempotent: only newly-added / still-unclassified items are processed.
 */

import { createDb } from "../shared/db.ts";
import { SQLiteDiscountItemRepository } from "../discount/adapters/sqlite-discount-item-repository.ts";
import { LlmCategoryClassifier } from "./adapters/llm-category-classifier.ts";
import { resolveLlm } from "../llm/resolve-llm.ts";
import { CategorisationService, type CategorisationResult } from "./categorisation-service.ts";
import type { CategoryClassifier, DiscountCategoryStore } from "./ports.ts";
import { ConsoleLogger, type Logger } from "../shared/logger.ts";

/** Dependency seam — inject fakes to unit-test wiring without a real DB/LLM. */
export interface CategoriseDeps {
  store: DiscountCategoryStore;
  classifier: CategoryClassifier | null;
  logger?: Logger;
}

/**
 * Runs categorisation over all uncategorised items and logs a summary.
 * Testable factory: production callers build deps from env (see buildDeps).
 */
export async function runCategorisation(deps: CategoriseDeps): Promise<CategorisationResult> {
  const logger = deps.logger ?? new ConsoleLogger();
  const service = new CategorisationService(deps.store, deps.classifier);
  const result = await service.run();
  logger.log("info", "categorise.run.done", {
    classified: result.classified,
    pending: result.pending,
  });
  return result;
}

/** Builds production deps from the current env (real DB + optional LLM classifier). */
export function buildDeps(): CategoriseDeps {
  const dbPath = process.env.TEST_DB_PATH ?? "./discount-hunt.db";
  const db = createDb(dbPath);
  const store = new SQLiteDiscountItemRepository(db);
  const llm = resolveLlm();
  const classifier = llm ? new LlmCategoryClassifier(llm) : null;
  return { store, classifier };
}

if (import.meta.main) {
  const runnerLogger = new ConsoleLogger();
  runCategorisation(buildDeps())
    .then(() => process.exit(0))
    .catch((err) => {
      runnerLogger.log("error", "categorise.run.refused", { error: String(err) });
      process.exit(1);
    });
}
