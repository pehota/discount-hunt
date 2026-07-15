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
 *   Catalogue-LLM config (used only when CATALOGUE_SOURCE=live; see
 *   catalogue-llm-config.ts for defaults and resolution rules):
 *     CATALOGUE_LLM_PROVIDER — "anthropic" (default) | "openai-compatible"
 *     CATALOGUE_LLM_MODEL    — model id (default: claude-haiku-4-5-20251001)
 *     CATALOGUE_LLM_BASE_URL — required for openai-compatible
 *     CATALOGUE_LLM_API_KEY  — the key; for anthropic falls back to ANTHROPIC_API_KEY
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
 *   2. Attempt V-Markt only when a catalogue LLM is configured (resolveCatalogueLlm)
 */

import { createDb } from "../shared/db.ts";
import { FakeAldiCatalogueAdapter } from "../../tests/acceptance/support/fake-aldi-catalogue-adapter.ts";
import { FakeVMarktCatalogueAdapter } from "../../tests/acceptance/support/fake-v-markt-catalogue-adapter.ts";
import { CatalogueNormalizer } from "./adapters/catalogue-normalizer.ts";
import { SQLiteScrapeJobRepository } from "./adapters/sqlite-scrape-job-repository.ts";
import { SQLiteDiscountItemRepository } from "../discount/adapters/sqlite-discount-item-repository.ts";
import { DiscountService } from "../discount/discount-service.ts";
import { ScrapingService } from "./scraping-service.ts";
import { AldiSudCatalogueFetcher } from "./adapters/aldi-sud-catalogue-fetcher.ts";
import { VMarktCatalogueFetcher } from "./adapters/v-markt-catalogue-fetcher.ts";
import { AiSdkCatalogueExtractor } from "./adapters/ai-sdk-catalogue-extractor.ts";
import { resolveCatalogueLlm } from "./adapters/catalogue-llm-config.ts";
import { ConsoleLogger, type Logger } from "../shared/logger.ts";

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
  runScrape?: (fetcher: CatalogueFetcher, store: string) => Promise<void>;
  logger?: Logger;
}

const ALDI_STORE = "Aldi Süd";
const VMARKT_STORE = "V-Markt";

// ── Testable factory ──────────────────────────────────────────────────────────

/**
 * Runs the live scrape for Aldi Süd and V-Markt.
 *
 * Exported for unit testing. Inject LiveScrapeDeps to stub DB + HTTP + Anthropic.
 * Production callers pass no deps (defaults build real collaborators).
 */
export async function runLiveScrape(deps: LiveScrapeDeps = {}): Promise<StoreResult[]> {
  const runScrape = deps.runScrape ?? makeProdRunScrape();
  const logger = deps.logger ?? new ConsoleLogger();
  const makeAldiFetcher = deps.makeAldiFetcher ?? (() => new AldiSudCatalogueFetcher());

  const summary: StoreResult[] = [];

  // Aldi Süd needs no API key — always attempts.
  summary.push(await isolatedScrape(runScrape, makeAldiFetcher(), ALDI_STORE, logger));

  // V-Markt requires a configured catalogue LLM. Resolve once; when non-null,
  // scrape (const-narrowing keeps `model` non-null inside the default factory).
  // When null, skip with a recorded reason — do NOT construct the LLM-backed fetcher.
  const model = resolveCatalogueLlm();
  if (model) {
    const makeVMarktFetcher =
      deps.makeVMarktFetcher ?? (() => new VMarktCatalogueFetcher(new AiSdkCatalogueExtractor(model)));
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

/** Recorded reason when the V-Markt leg is skipped due to no usable LLM config. */
export const LLM_NOT_CONFIGURED = "catalogue LLM not configured";

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
  return { normalizer, scrapeJobRepo, discountService };
}

/** Returns a scrape runner wired to real DB infrastructure. */
function makeProdRunScrape(): (fetcher: CatalogueFetcher, store: string) => Promise<void> {
  const { normalizer, scrapeJobRepo, discountService } = buildInfrastructure();
  return async (fetcher, store) => {
    const service = new ScrapingService(
      fetcher as { fetchCurrentWeek(): Promise<unknown[]> },
      normalizer,
      scrapeJobRepo,
      discountService,
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

  const { normalizer, scrapeJobRepo, discountService } = buildInfrastructure();

  const runScrape = async (fetcher: CatalogueFetcher, store: string) => {
    await new ScrapingService(fetcher, normalizer, scrapeJobRepo, discountService).run(store);
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

  if (source === CATALOGUE_SOURCE_FAKE) {
    return runFakeScrape();
  }

  return runLiveScrape();
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
