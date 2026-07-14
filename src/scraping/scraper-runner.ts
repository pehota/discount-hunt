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
 *   ANTHROPIC_API_KEY      — required when CATALOGUE_SOURCE=live
 *
 * Wire order (fake mode):
 *   1. Build shared infrastructure: db, normalizer, repos, discountService
 *   2. Run Aldi Süd scrape (FAKE_CATALOGUE_FIXTURE required)
 *   3. Run V-Markt scrape if FAKE_VMARKT_FIXTURE is set (optional — backward-compatible)
 *   4. process.exit(0) on success, process.exit(1) on error
 *
 * Wire order (live mode):
 *   1. Check ANTHROPIC_API_KEY — throw health.scrape.refused if absent
 *   2. Instantiate AldiSudCatalogueFetcher and VMarktCatalogueFetcher(HaikuCatalogueExtractor)
 *   3. Run both via ScrapingService.run("Aldi Süd") and ScrapingService.run("V-Markt")
 *   4. process.exit(0) on success, process.exit(1) on error
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
import { HaikuCatalogueExtractor } from "./adapters/haiku-catalogue-extractor.ts";

// ── Constants ─────────────────────────────────────────────────────────────────

const CATALOGUE_SOURCE_FAKE = "fake";

// ── Types ─────────────────────────────────────────────────────────────────────

interface CatalogueFetcher {
  fetchCurrentWeek(): Promise<unknown[]>;
}

/** Dependency seam for runLiveScrape — enables wiring tests without DB or HTTP. */
export interface LiveScrapeDeps {
  makeAldiFetcher?: () => CatalogueFetcher;
  makeVMarktFetcher?: () => CatalogueFetcher;
  runScrape?: (fetcher: CatalogueFetcher, store: string) => Promise<void>;
}

// ── Testable factory ──────────────────────────────────────────────────────────

/**
 * Runs the live scrape for Aldi Süd and V-Markt.
 *
 * Exported for unit testing. Inject LiveScrapeDeps to stub DB + HTTP + Anthropic.
 * Production callers pass no deps (defaults build real collaborators).
 */
export async function runLiveScrape(deps: LiveScrapeDeps = {}): Promise<void> {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("health.scrape.refused: ANTHROPIC_API_KEY is required for live catalogue source");
  }

  const runScrape = deps.runScrape ?? makeProdRunScrape();
  const makeAldiFetcher = deps.makeAldiFetcher ?? (() => new AldiSudCatalogueFetcher());
  const makeVMarktFetcher = deps.makeVMarktFetcher ?? (() => new VMarktCatalogueFetcher(new HaikuCatalogueExtractor()));

  await runScrape(makeAldiFetcher(), "Aldi Süd");
  await runScrape(makeVMarktFetcher(), "V-Markt");
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

async function runFakeScrape(): Promise<void> {
  const aldiFixturePath = process.env.FAKE_CATALOGUE_FIXTURE;
  if (!aldiFixturePath) {
    throw new Error("FAKE_CATALOGUE_FIXTURE env var is required when CATALOGUE_SOURCE=fake");
  }

  const { normalizer, scrapeJobRepo, discountService } = buildInfrastructure();

  // Aldi Süd scrape (always required in fake mode)
  await new ScrapingService(
    FakeAldiCatalogueAdapter.fromFixtureFile(aldiFixturePath),
    normalizer,
    scrapeJobRepo,
    discountService,
  ).run("Aldi Süd");

  // V-Markt scrape (optional — enabled only when FAKE_VMARKT_FIXTURE is set)
  const vMarktFixturePath = process.env.FAKE_VMARKT_FIXTURE;
  if (vMarktFixturePath) {
    await new ScrapingService(
      FakeVMarktCatalogueAdapter.fromFixtureFile(vMarktFixturePath),
      normalizer,
      scrapeJobRepo,
      discountService,
    ).run("V-Markt");
  }
}

// ── CLI entry point ───────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const source = process.env.CATALOGUE_SOURCE ?? "live";

  if (source === CATALOGUE_SOURCE_FAKE) {
    return runFakeScrape();
  }

  return runLiveScrape();
}

if (import.meta.main) {
  main()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("health.scrape.refused", err);
      process.exit(1);
    });
}
