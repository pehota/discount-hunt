/**
 * Scraper CLI entry point (D18: one-shot script).
 *
 * Invocation: bun run src/scraping/scraper-runner.ts
 *
 * Environment variables (test seam — D35 / ATDD Infrastructure Policy):
 *   TEST_DB_PATH           — path to SQLite file; defaults to ./discount-hunt.db
 *   CATALOGUE_SOURCE       — "fake" | "live" (default: "live")
 *   FAKE_CATALOGUE_FIXTURE — path to Aldi JSON fixture (required when CATALOGUE_SOURCE=fake)
 *   FAKE_VMARKT_FIXTURE    — path to V-Markt JSON fixture (optional; enables V-Markt scrape)
 *
 *   LLM config (used only when CATALOGUE_SOURCE=live; see src/llm/resolve-llm.ts
 *   for the switch and resolution rules):
 *     LLM_PROVIDER       — "claude-cli" (dev) | "openrouter" (prod); unset = LLM off
 *     CLAUDE_CLI_MODEL   — optional model id for the local `claude` CLI
 *     OPENROUTER_API_KEY — required for openrouter
 *     OPENROUTER_MODEL   — required for openrouter
 *
 *   EDEKA_PLZ            — postal code for the marktguru EDEKA scrape (default 80331);
 *                          EDEKA always attempts (no LLM required, like Aldi Süd).
 *
 * Resilience contract (step 09-01):
 *   - Each store's scrape is isolated in a try/catch. One store failing is
 *     recorded (console.error "health.scrape.store_failed") and skipped; the run
 *     continues with the remaining stores. ScrapingService.run already fails the
 *     job in scrape_jobs and rethrows; the runner swallows that rethrow to keep
 *     going.
 *   - A missing/unconfigured catalogue LLM no longer aborts the run. Aldi Süd
 *     always attempts; the V-Markt leg is skipped with a recorded reason and the
 *     LLM-backed fetcher is NOT constructed.
 *   - Both runners return a per-store summary: Array<{store, ok, error?}>.
 *   - main() maps the summary to an exit code via exitCodeFor: exit 0 if any
 *     store is ok, exit 1 if none. A catastrophic pre-store failure (DB/infra
 *     build throws) is caught in the entry point and still exits 1.
 *
 * Wire order (fake mode):
 *   1. Build shared infrastructure: db, normalizer, repos, discountService
 *   2. Run Aldi Süd scrape (FAKE_CATALOGUE_FIXTURE required)
 *   3. Run V-Markt scrape if FAKE_VMARKT_FIXTURE is set (optional — backward-compatible)
 *
 * Wire order (live mode):
 *   1. Attempt Aldi Süd (needs no API key)
 *   2. Attempt EDEKA (marktguru API — always attempts, no LLM required)
 *   3. Attempt V-Markt only when an LLM is configured (resolveLlm)
 */

import { createDb } from "../shared/db.ts";
import { STORES } from "../shared/stores.ts";
import { FakeAldiCatalogueAdapter } from "../../tests/acceptance/support/fake-aldi-catalogue-adapter.ts";
import { FakeVMarktCatalogueAdapter } from "../../tests/acceptance/support/fake-v-markt-catalogue-adapter.ts";
import { CatalogueNormalizer } from "./adapters/catalogue-normalizer.ts";
import { SQLiteScrapeJobRepository } from "./adapters/sqlite-scrape-job-repository.ts";
import { SQLiteDiscountItemRepository } from "../discount/adapters/sqlite-discount-item-repository.ts";
import { DiscountService } from "../discount/discount-service.ts";
import { ScrapingService } from "./scraping-service.ts";
import { AldiSudCatalogueFetcher } from "./adapters/aldi-sud-catalogue-fetcher.ts";
import { VMarktCatalogueFetcher } from "./adapters/v-markt-catalogue-fetcher.ts";
import { MarktguruEdekaCatalogueFetcher, DEFAULT_PLZ } from "./adapters/marktguru-edeka-catalogue-fetcher.ts";
import { LlmCatalogueExtractor } from "./adapters/llm-catalogue-extractor.ts";
import { resolveLlm } from "../llm/resolve-llm.ts";
import { LlmCategoryClassifier } from "../categorisation/adapters/llm-category-classifier.ts";
import { runCategorisation, buildDeps as buildCategoriseDeps } from "../categorisation/categoriser-runner.ts";
import { ConsoleLogger, type Logger } from "../shared/logger.ts";

// Re-exported so existing importers (e.g. scraper-runner.test.ts) keep the same
// symbol; the value lives in one place (src/llm/resolve-llm.ts).
export { LLM_NOT_CONFIGURED } from "../llm/resolve-llm.ts";
import { LLM_NOT_CONFIGURED } from "../llm/resolve-llm.ts";

// ── Constants ─────────────────────────────────────────────────────────────────

const CATALOGUE_SOURCE_FAKE = "fake";

// ── Types ─────────────────────────────────────────────────────────────────────

interface CatalogueFetcher {
  fetchCurrentWeek(): Promise<unknown[]>;
}

/** Per-store outcome collected across the run. */
export interface StoreResult {
  store: string;
  ok: boolean;
  error?: string;
}

/** Dependency seam for runLiveScrape — enables wiring tests without DB or HTTP. */
export interface LiveScrapeDeps {
  makeAldiFetcher?: () => CatalogueFetcher;
  makeVMarktFetcher?: () => CatalogueFetcher;
  makeEdekaFetcher?: () => CatalogueFetcher;
  runScrape?: (fetcher: CatalogueFetcher, store: string) => Promise<void>;
  logger?: Logger;
}

const ALDI_STORE = STORES.find((s) => s.slug === "aldi-sued")!.name;
const VMARKT_STORE = STORES.find((s) => s.slug === "v-markt")!.name;
const EDEKA_STORE = STORES.find((s) => s.slug === "edeka")!.name;

// ── Testable factory ──────────────────────────────────────────────────────────

/**
 * Runs the live scrape for Aldi Süd, EDEKA, and V-Markt.
 *
 * Exported for unit testing. Inject LiveScrapeDeps to stub DB + HTTP + LLM.
 * Production callers pass no deps (defaults build real collaborators).
 */
export async function runLiveScrape(deps: LiveScrapeDeps = {}): Promise<StoreResult[]> {
  const runScrape = deps.runScrape ?? makeProdRunScrape();
  const logger = deps.logger ?? new ConsoleLogger();
  const makeAldiFetcher = deps.makeAldiFetcher ?? (() => new AldiSudCatalogueFetcher());
  const makeEdekaFetcher =
    deps.makeEdekaFetcher ??
    (() => new MarktguruEdekaCatalogueFetcher({ plz: process.env.EDEKA_PLZ ?? DEFAULT_PLZ }));

  const summary: StoreResult[] = [];

  // Aldi Süd needs no API key — always attempts.
  summary.push(await isolatedScrape(runScrape, makeAldiFetcher(), ALDI_STORE, logger));

  // EDEKA (marktguru API) needs no LLM — always attempts, like Aldi.
  summary.push(await isolatedScrape(runScrape, makeEdekaFetcher(), EDEKA_STORE, logger));

  // V-Markt requires a configured LLM. Resolve once; when non-null, scrape
  // (const-narrowing keeps `llm` non-null inside the default factory). When null,
  // skip with a recorded reason — do NOT construct the LLM-backed fetcher.
  const llm = resolveLlm();
  if (llm) {
    const makeVMarktFetcher =
      deps.makeVMarktFetcher ?? (() => new VMarktCatalogueFetcher(new LlmCatalogueExtractor(llm)));
    summary.push(await isolatedScrape(runScrape, makeVMarktFetcher(), VMARKT_STORE, logger));
  } else {
    logger.log("warn", "scrape.summary", {
      store: VMARKT_STORE,
      ok: false,
      error: LLM_NOT_CONFIGURED,
    });
    summary.push({ store: VMARKT_STORE, ok: false, error: LLM_NOT_CONFIGURED });
  }

  return summary;
}

/** Runs one store's scrape, converting any throw into a recorded failure. */
async function isolatedScrape(
  runScrape: (fetcher: CatalogueFetcher, store: string) => Promise<void>,
  fetcher: CatalogueFetcher,
  store: string,
  logger: Logger = new ConsoleLogger(),
): Promise<StoreResult> {
  try {
    await runScrape(fetcher, store);
    logger.log("info", "scrape.summary", { store, ok: true });
    return { store, ok: true };
  } catch (error) {
    logger.log("warn", "scrape.summary", { store, ok: false, error: String(error) });
    return { store, ok: false, error: String(error) };
  }
}

/** Maps a per-store summary to a process exit code: 0 if any ok, else 1. */
export function exitCodeFor(summary: StoreResult[]): number {
  return summary.some((result) => result.ok) ? 0 : 1;
}

/** Builds DB, normalizer, repos and services from the current env. */
function buildInfrastructure() {
  const dbPath = process.env.TEST_DB_PATH ?? "./discount-hunt.db";
  const db = createDb(dbPath);
  const normalizer = new CatalogueNormalizer();
  const scrapeJobRepo = new SQLiteScrapeJobRepository(db);
  const discountService = new DiscountService(new SQLiteDiscountItemRepository(db));
  // Categorise-before-insert: resolve the LLM once and build the classifier so
  // ScrapingService can classify each batch in memory before the atomic swap.
  // When no LLM is configured (null), the classifier is null → today's behavior
  // (NULL taxonomy at insert; the post-scrape hook heals later).
  const llm = resolveLlm();
  const classifier = llm ? new LlmCategoryClassifier(llm) : null;
  return { normalizer, scrapeJobRepo, discountService, classifier };
}

/** Returns a scrape runner wired to real DB infrastructure. */
function makeProdRunScrape(): (fetcher: CatalogueFetcher, store: string) => Promise<void> {
  const { normalizer, scrapeJobRepo, discountService, classifier } = buildInfrastructure();
  return async (fetcher, store) => {
    const service = new ScrapingService(
      fetcher as { fetchCurrentWeek(): Promise<unknown[]> },
      normalizer,
      scrapeJobRepo,
      discountService,
      undefined,
      classifier,
    );
    await service.run(store);
  };
}

// ── Fake mode runner ──────────────────────────────────────────────────────────

async function runFakeScrape(): Promise<StoreResult[]> {
  const aldiFixturePath = process.env.FAKE_CATALOGUE_FIXTURE;
  if (!aldiFixturePath) {
    throw new Error("FAKE_CATALOGUE_FIXTURE env var is required when CATALOGUE_SOURCE=fake");
  }

  const { normalizer, scrapeJobRepo, discountService, classifier } = buildInfrastructure();

  const runScrape = async (fetcher: CatalogueFetcher, store: string) => {
    await new ScrapingService(fetcher, normalizer, scrapeJobRepo, discountService, undefined, classifier).run(store);
  };

  const summary: StoreResult[] = [];

  // Aldi Süd scrape (always required in fake mode).
  summary.push(
    await isolatedScrape(runScrape, FakeAldiCatalogueAdapter.fromFixtureFile(aldiFixturePath), ALDI_STORE),
  );

  // V-Markt scrape (optional — enabled only when FAKE_VMARKT_FIXTURE is set).
  const vMarktFixturePath = process.env.FAKE_VMARKT_FIXTURE;
  if (vMarktFixturePath) {
    summary.push(
      await isolatedScrape(runScrape, FakeVMarktCatalogueAdapter.fromFixtureFile(vMarktFixturePath), VMARKT_STORE),
    );
  }

  return summary;
}

// ── CLI entry point ───────────────────────────────────────────────────────────

async function main(): Promise<StoreResult[]> {
  const source = process.env.CATALOGUE_SOURCE ?? "live";

  const summary = source === CATALOGUE_SOURCE_FAKE ? await runFakeScrape() : await runLiveScrape();

  // Post-scrape categorisation over all products (NULL-only → only new items).
  // Isolated: a failure here logs but MUST NOT fail the scrape run.
  try {
    await runCategorisation(buildCategoriseDeps());
  } catch (error) {
    new ConsoleLogger().log("warn", "categorise.post_scrape.failed", { error: String(error) });
  }

  return summary;
}

if (import.meta.main) {
  const runnerLogger = new ConsoleLogger();
  main()
    .then((summary) => {
      // Per-store `scrape.summary` events are emitted at the store site
      // (isolatedScrape / key-absent branch). Here we emit only the run tally.
      const okCount = summary.filter((result) => result.ok).length;
      runnerLogger.log("info", "scrape.run.done", {
        okCount,
        failedCount: summary.length - okCount,
      });
      process.exit(exitCodeFor(summary));
    })
    .catch((err) => {
      // Catastrophic pre-store failure (DB / infra build threw) — no store ran.
      runnerLogger.log("error", "health.scrape.refused", { error: String(err) });
      process.exit(1);
    });
}
