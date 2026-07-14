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

interface CatalogueFetcher {
  fetchCurrentWeek(): Promise<unknown[]>;
}

export class ScrapingService {
  constructor(
    private readonly catalogueFetcher: CatalogueFetcher,
    private readonly catalogueNormalizer: CatalogueNormalizer,
    private readonly scrapeJobRepository: SQLiteScrapeJobRepository,
    private readonly discountService: DiscountService,
  ) {}

  async run(store: string = "aldi-sud"): Promise<void> {
    const jobId = await this.scrapeJobRepository.startJob(store);
    try {
      const rawItems = await this.catalogueFetcher.fetchCurrentWeek();
      const normalizedItems = this.catalogueNormalizer.normalize(rawItems);
      for (const item of normalizedItems) {
        await this.discountService.registerDiscountItem(item, jobId);
      }
      await this.scrapeJobRepository.completeJob(jobId, normalizedItems.length);
    } catch (error) {
      await this.scrapeJobRepository.failJob(jobId, String(error));
      throw error;
    }
  }
}
