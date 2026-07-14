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
 * Wire order (fake mode):
 *   1. Build shared infrastructure: db, normalizer, repos, discountService
 *   2. Run Aldi Süd scrape (FAKE_CATALOGUE_FIXTURE required)
 *   3. Run V-Markt scrape if FAKE_VMARKT_FIXTURE is set (optional — backward-compatible)
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

async function main(): Promise<void> {
  const source = process.env.CATALOGUE_SOURCE ?? "live";
  const dbPath = process.env.TEST_DB_PATH ?? "./discount-hunt.db";

  if (source !== "fake") {
    throw new Error("Live catalogue source not yet implemented — use CATALOGUE_SOURCE=fake");
  }

  const aldiFixturePath = process.env.FAKE_CATALOGUE_FIXTURE;
  if (!aldiFixturePath) {
    throw new Error("FAKE_CATALOGUE_FIXTURE env var is required when CATALOGUE_SOURCE=fake");
  }

  const db = createDb(dbPath);
  const normalizer = new CatalogueNormalizer();
  const scrapeJobRepo = new SQLiteScrapeJobRepository(db);
  const discountItemRepo = new SQLiteDiscountItemRepository(db);
  const discountService = new DiscountService(discountItemRepo);

  // Aldi Süd scrape (always required in fake mode)
  const aldiService = new ScrapingService(
    FakeAldiCatalogueAdapter.fromFixtureFile(aldiFixturePath),
    normalizer,
    scrapeJobRepo,
    discountService,
  );
  await aldiService.run("Aldi Süd");

  // V-Markt scrape (optional — enabled only when FAKE_VMARKT_FIXTURE is set)
  const vMarktFixturePath = process.env.FAKE_VMARKT_FIXTURE;
  if (vMarktFixturePath) {
    const vMarktService = new ScrapingService(
      FakeVMarktCatalogueAdapter.fromFixtureFile(vMarktFixturePath),
      normalizer,
      scrapeJobRepo,
      discountService,
    );
    await vMarktService.run("V-Markt");
  }
}

if (import.meta.main) {
  main()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("health.scrape.refused", err);
      process.exit(1);
    });
}
