/**
 * ScrapingService lifecycle-logging tests.
 *
 * Drives the service through run() with a stub fetcher (N raw of which M survive
 * normalize) over real sqlite + real repos, and a spy Logger capturing every
 * event. Asserts the lifecycle event sequence and the COUNT fields
 * (rawCount, normalizedCount, dropped, registered, itemCount) plus the failure
 * event on error.
 *
 * bypass: interaction/wiring test over a spy logger — verifies emitted event
 * sequence + count fields, not a generative invariant.
 */

import { describe, test, expect } from "bun:test";
import type { LogLevel, Logger } from "../shared/logger.ts";
import { createDb } from "../shared/db.ts";
import { scrapeJobs, discountItems } from "../shared/schema.ts";
import { CatalogueNormalizer } from "./adapters/catalogue-normalizer.ts";
import { SQLiteScrapeJobRepository } from "./adapters/sqlite-scrape-job-repository.ts";
import { SQLiteDiscountItemRepository } from "../discount/adapters/sqlite-discount-item-repository.ts";
import { DiscountService } from "../discount/discount-service.ts";
import { ScrapingService } from "./scraping-service.ts";
import type { CategoryClassifier } from "../categorisation/ports.ts";
import type { NormalizedItem, TaxonomyCategory, Tag } from "../shared/types.ts";

interface CapturedEvent {
  level: LogLevel;
  event: string;
  fields: Record<string, unknown>;
}

class SpyLogger implements Logger {
  readonly events: CapturedEvent[] = [];
  log(level: LogLevel, event: string, fields?: Record<string, unknown>): void {
    this.events.push({ level, event, fields: fields ?? {} });
  }
  eventNames(): string[] {
    return this.events.map((e) => e.event);
  }
  find(event: string): CapturedEvent | undefined {
    return this.events.find((e) => e.event === event);
  }
}

/** Raw Aldi-shaped hotspot; a valid discount survives normalize, no discountedPrice is dropped. */
function rawItem(id: string, opts: { discounted: boolean }) {
  return {
    id,
    title: `Item ${id}`,
    brand: "Aldi",
    price: "2.99",
    discountedPrice: opts.discounted ? "1.49" : "",
    customLabel1: "2026-07-14",
    productType: "vegetable",
    photoUrls: [] as string[],
  };
}

function buildService(rawItems: unknown[], logger: Logger, classifier: CategoryClassifier | null = null) {
  const db = createDb(":memory:");
  const fetcher = { fetchCurrentWeek: async () => rawItems };
  const normalizer = new CatalogueNormalizer();
  const scrapeJobRepo = new SQLiteScrapeJobRepository(db);
  const discountService = new DiscountService(new SQLiteDiscountItemRepository(db));
  const service = new ScrapingService(fetcher, normalizer, scrapeJobRepo, discountService, logger, classifier);
  return { service, db };
}

describe("ScrapingService — lifecycle logging (success)", () => {
  test("emits the lifecycle sequence with correct count/dropped fields", async () => {
    // 3 raw, 1 dropped (no discountedPrice) → 2 normalized/registered.
    const raw = [
      rawItem("a", { discounted: true }),
      rawItem("b", { discounted: true }),
      rawItem("c", { discounted: false }),
    ];
    const spy = new SpyLogger();
    const { service } = buildService(raw, spy);

    await service.run("Aldi Süd");

    expect(spy.eventNames()).toEqual([
      "scrape.store.start",
      "scrape.fetch",
      "scrape.normalize",
      "scrape.register",
      "scrape.store.completed",
    ]);

    expect(spy.find("scrape.store.start")!.fields.store).toBe("Aldi Süd");
    expect(spy.find("scrape.fetch")!.fields).toMatchObject({ store: "Aldi Süd", rawCount: 3 });
    expect(spy.find("scrape.normalize")!.fields).toMatchObject({
      store: "Aldi Süd",
      normalizedCount: 2,
      dropped: 1,
    });
    expect(spy.find("scrape.register")!.fields).toMatchObject({ store: "Aldi Süd", registered: 2 });

    const completed = spy.find("scrape.store.completed")!;
    expect(completed.fields).toMatchObject({ store: "Aldi Süd", itemCount: 2 });
    expect(typeof completed.fields.durationMs).toBe("number");
  });
});

describe("ScrapingService — lifecycle logging (failure)", () => {
  test("emits scrape.store.failed with the error before rethrowing", async () => {
    const spy = new SpyLogger();
    const db = createDb(":memory:");
    const fetcher = {
      fetchCurrentWeek: async () => {
        throw new Error("boom");
      },
    };
    const normalizer = new CatalogueNormalizer();
    const scrapeJobRepo = new SQLiteScrapeJobRepository(db);
    const discountService = new DiscountService(new SQLiteDiscountItemRepository(db));
    const service = new ScrapingService(fetcher, normalizer, scrapeJobRepo, discountService, spy);

    await expect(service.run("Aldi Süd")).rejects.toThrow("boom");

    const failed = spy.find("scrape.store.failed");
    expect(failed).toBeDefined();
    expect(failed!.level).toBe("error");
    expect(failed!.fields.store).toBe("Aldi Süd");
    expect(String(failed!.fields.error)).toContain("boom");
    // start fired, completed did not.
    expect(spy.eventNames()).toContain("scrape.store.start");
    expect(spy.eventNames()).not.toContain("scrape.store.completed");
  });

  test("does NOT replace store items when normalize yields empty (guards against wiping on flaky extraction)", async () => {
    const spy = new SpyLogger();
    const db = createDb(":memory:");
    // Fetch succeeds with raw items, but normalize yields [] (e.g. LLM extraction returns nothing without throwing).
    const fetcher = { fetchCurrentWeek: async (): Promise<unknown[]> => [rawItem("a", { discounted: true })] };
    const normalizer = { normalize: (): NormalizedItem[] => [] } as unknown as CatalogueNormalizer;
    const scrapeJobRepo = new SQLiteScrapeJobRepository(db);

    const replaceStoreCalls: { store: string; items: NormalizedItem[]; scrapeJobId: string }[] = [];
    const fakeDiscountService = {
      replaceStoreItems: async (store: string, items: NormalizedItem[], scrapeJobId: string): Promise<void> => {
        replaceStoreCalls.push({ store, items, scrapeJobId });
      },
    } as unknown as DiscountService;

    const service = new ScrapingService(fetcher, normalizer, scrapeJobRepo, fakeDiscountService, spy);

    // Empty normalize is NOT an error — run() completes without throwing.
    await service.run("Aldi Süd");

    // Never deleted/replaced — existing rows left intact.
    expect(replaceStoreCalls.length).toBe(0);

    // A visible warn was logged.
    const skipped = spy.find("scrape.replace.skipped_empty");
    expect(skipped).toBeDefined();
    expect(skipped!.level).toBe("warn");
    expect(skipped!.fields.store).toBe("Aldi Süd");

    // Job COMPLETED (not failed) with count 0.
    expect(spy.eventNames()).toContain("scrape.store.completed");
    expect(spy.eventNames()).not.toContain("scrape.store.failed");
    const jobs = db.select().from(scrapeJobs).all();
    expect(jobs.length).toBe(1);
    expect(jobs[0]!.status).toBe("completed");
    expect(jobs[0]!.itemCount).toBe(0);
  });

  test("does NOT replace store items when fetch throws (delete only after successful fetch)", async () => {
    const spy = new SpyLogger();
    const db = createDb(":memory:");
    const fetcher = {
      fetchCurrentWeek: async (): Promise<unknown[]> => {
        throw new Error("boom");
      },
    };
    const normalizer = new CatalogueNormalizer();
    const scrapeJobRepo = new SQLiteScrapeJobRepository(db);

    const replaceStoreCalls: { store: string; items: NormalizedItem[]; scrapeJobId: string }[] = [];
    const fakeDiscountService = {
      replaceStoreItems: async (store: string, items: NormalizedItem[], scrapeJobId: string): Promise<void> => {
        replaceStoreCalls.push({ store, items, scrapeJobId });
      },
    } as unknown as DiscountService;

    const service = new ScrapingService(fetcher, normalizer, scrapeJobRepo, fakeDiscountService, spy);

    await expect(service.run("Aldi Süd")).rejects.toThrow("boom");

    // Never deleted/replaced — fetch failed before the replace step.
    expect(replaceStoreCalls.length).toBe(0);

    // Job was marked failed (proven via the real repo's table).
    const jobs = db.select().from(scrapeJobs).all();
    expect(jobs.length).toBe(1);
    expect(jobs[0]!.status).toBe("failed");
  });
});

describe("ScrapingService — categorise-before-insert", () => {
  // Small batch (2-3 items, well under CLASSIFY_CHUNK_SIZE) so tests never depend
  // on the chunk-size constant: 2 discounted raw items → 2 normalized rows.
  const rawBatch = () => [
    rawItem("a", { discounted: true }),
    rawItem("b", { discounted: true }),
  ];

  test("classifies before insert → rows land WITH taxonomy+tags, zero NULL taxonomy window", async () => {
    // Classifier returns an order-aligned, same-length result per the port contract.
    class FakeClassifier implements CategoryClassifier {
      async classify(items: { name: string; productType: string }[]) {
        return items.map(() => ({
          category: "Produce" as TaxonomyCategory,
          tags: ["Organic"] as Tag[],
        }));
      }
    }
    const spy = new SpyLogger();
    const { service, db } = buildService(rawBatch(), spy, new FakeClassifier());

    await service.run("Aldi Süd");

    // Query the table directly — every inserted row is already categorised.
    const rows = db.select().from(discountItems).all();
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.taxonomyCategory).toBe("Produce");
      expect(row.tags).toBe('["Organic"]');
    }
    // No NULL taxonomy anywhere → no "Other" window.
    expect(rows.every((row) => row.taxonomyCategory !== null)).toBe(true);
  });

  test("classifier throws → graceful: run() resolves, rows still inserted with NULL taxonomy, warn logged", async () => {
    class ThrowingClassifier implements CategoryClassifier {
      async classify(): Promise<{ category: TaxonomyCategory; tags: Tag[] }[]> {
        throw new Error("llm exploded");
      }
    }
    const spy = new SpyLogger();
    const { service, db } = buildService(rawBatch(), spy, new ThrowingClassifier());

    // Categorisation failure MUST NOT fail the scrape.
    await service.run("Aldi Süd");

    // Rows still inserted, but uncategorised (the post-scrape hook heals later).
    const rows = db.select().from(discountItems).all();
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => row.taxonomyCategory === null)).toBe(true);

    // A visible warn was logged and the scrape still completed.
    const failed = spy.find("scrape.categorise.failed");
    expect(failed).toBeDefined();
    expect(failed!.level).toBe("warn");
    expect(failed!.fields.store).toBe("Aldi Süd");
    expect(String(failed!.fields.error)).toContain("llm exploded");
    expect(spy.eventNames()).toContain("scrape.store.completed");
    expect(spy.eventNames()).not.toContain("scrape.store.failed");
  });
});
