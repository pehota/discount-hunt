/**
 * ScrapingService — orchestrates the ScrapeJob lifecycle.
 *
 * Commands: StartScrape → fetch → normalize → RegisterDiscountItem × N → CompleteScrape / FailScrape
 *
 * Driven ports used:
 *   - CatalogueFetcher (via constructor injection)
 *   - SQLiteScrapeJobRepository
 *   - DiscountService (RegisterDiscountItem)
 */

import type { CatalogueNormalizer } from "./adapters/catalogue-normalizer.ts";
import type { SQLiteScrapeJobRepository } from "./adapters/sqlite-scrape-job-repository.ts";
import type { DiscountService } from "../discount/discount-service.ts";
import { ConsoleLogger, type Logger } from "../shared/logger.ts";

interface CatalogueFetcher {
  fetchCurrentWeek(): Promise<unknown[]>;
}

export class ScrapingService {
  constructor(
    private readonly catalogueFetcher: CatalogueFetcher,
    private readonly catalogueNormalizer: CatalogueNormalizer,
    private readonly scrapeJobRepository: SQLiteScrapeJobRepository,
    private readonly discountService: DiscountService,
    private readonly logger: Logger = new ConsoleLogger(),
  ) {}

  async run(store: string = "Aldi Süd"): Promise<void> {
    const startedAt = Date.now();
    this.logger.log("info", "scrape.store.start", { store });
    const jobId = await this.scrapeJobRepository.startJob(store);
    try {
      const rawItems = await this.catalogueFetcher.fetchCurrentWeek();
      const rawCount = rawItems.length;
      this.logger.log("info", "scrape.fetch", { store, rawCount });

      const normalizedItems = this.catalogueNormalizer.normalize(rawItems, store);
      const normalizedCount = normalizedItems.length;
      this.logger.log("info", "scrape.normalize", {
        store,
        normalizedCount,
        dropped: rawCount - normalizedCount,
      });

      // Guard against wiping a store on a flaky-but-non-throwing extraction:
      // an empty normalize would DELETE all rows and insert 0. Skip the replace,
      // keep the existing (stale) rows, and complete the job with count 0.
      if (normalizedCount === 0) {
        this.logger.log("warn", "scrape.replace.skipped_empty", { store });
        await this.scrapeJobRepository.completeJob(jobId, 0);
        this.logger.log("info", "scrape.store.completed", {
          store,
          itemCount: 0,
          durationMs: Date.now() - startedAt,
        });
        return;
      }

      // Replace-per-store: delete happens only now that fetch+normalize succeeded.
      await this.discountService.replaceStoreItems(store, normalizedItems, jobId);
      const registered = normalizedCount;
      this.logger.log("info", "scrape.register", { store, registered });

      await this.scrapeJobRepository.completeJob(jobId, normalizedCount);
      this.logger.log("info", "scrape.store.completed", {
        store,
        itemCount: normalizedCount,
        durationMs: Date.now() - startedAt,
      });
    } catch (error) {
      this.logger.log("error", "scrape.store.failed", { store, error: String(error) });
      await this.scrapeJobRepository.failJob(jobId, String(error));
      throw error;
    }
  }
}
