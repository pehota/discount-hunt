/**
 * Scraper CLI entry point (D18: one-shot script).
 *
 * Invocation: bun run src/scraping/scraper-runner.ts [--store aldi-sud]
 *
 * Environment variables (test seam — D35 / ATDD Infrastructure Policy):
 *   TEST_DB_PATH      — path to SQLite file; defaults to ./discount-hunt.db
 *   CATALOGUE_SOURCE  — "fake" | "live" (default: "live")
 *   FAKE_CATALOGUE_FIXTURE — path to JSON fixture file (required when CATALOGUE_SOURCE=fake)
 *
 * Wire order:
 *   1. Select CatalogueFetcher: FakeAldiCatalogueAdapter (fake) or throw (live — not yet implemented)
 *   2. createDb(dbPath)
 *   3. new ScrapingService(fetcher, normalizer, scrapeJobRepo, discountService)
 *   4. await scrapingService.run()
 *   5. process.exit(0) on success, process.exit(1) on error
 */

import { createDb } from "../shared/db.ts";
import { FakeAldiCatalogueAdapter } from "../../tests/acceptance/support/fake-aldi-catalogue-adapter.ts";
import { CatalogueNormalizer } from "./adapters/catalogue-normalizer.ts";
import { SQLiteScrapeJobRepository } from "./adapters/sqlite-scrape-job-repository.ts";
import { SQLiteDiscountItemRepository } from "../discount/adapters/sqlite-discount-item-repository.ts";
import { DiscountService } from "../discount/discount-service.ts";
import { ScrapingService } from "./scraping-service.ts";

async function main(): Promise<void> {
  const source = process.env.CATALOGUE_SOURCE ?? "live";
  const dbPath = process.env.TEST_DB_PATH ?? "./discount-hunt.db";

  const db = createDb(dbPath);

  let catalogueFetcher;
  if (source === "fake") {
    const fixturePath = process.env.FAKE_CATALOGUE_FIXTURE;
    if (!fixturePath) {
      throw new Error("FAKE_CATALOGUE_FIXTURE env var is required when CATALOGUE_SOURCE=fake");
    }
    catalogueFetcher = FakeAldiCatalogueAdapter.fromFixtureFile(fixturePath);
  } else {
    throw new Error("Live catalogue source not yet implemented — use CATALOGUE_SOURCE=fake");
  }

  const normalizer = new CatalogueNormalizer();
  const scrapeJobRepo = new SQLiteScrapeJobRepository(db);
  const discountItemRepo = new SQLiteDiscountItemRepository(db);
  const discountService = new DiscountService(discountItemRepo);
  const scrapingService = new ScrapingService(catalogueFetcher, normalizer, scrapeJobRepo, discountService);

  await scrapingService.run("aldi-sud");
}

if (import.meta.main) {
  main()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("health.scrape.refused", err);
      process.exit(1);
    });
}
