/**
 * SQLiteScrapeJobRepository — secondary adapter implementing ScrapeJobRepository port.
 *
 * Table: scrape_jobs (see src/shared/schema.ts)
 * Commands: startJob, completeJob, failJob
 *
 * Invariants enforced:
 *   - last_successful_run updated ONLY on status='completed'
 *   - failJob must NOT update completed_at
 */

import { and, eq, max } from "drizzle-orm";
import type { DbClient } from "../../shared/db.ts";
import { scrapeJobs, stores } from "../../shared/schema.ts";
import { getOrCreateStoreId, findStoreId } from "../../shared/store-registry.ts";

export class SQLiteScrapeJobRepository {
  constructor(private readonly db: DbClient) {}

  async startJob(store: string): Promise<string> {
    const id = crypto.randomUUID();
    const storeId = getOrCreateStoreId(this.db, store);
    this.db.insert(scrapeJobs).values({
      id,
      storeId,
      status: "running",
      startedAt: Date.now(),
      itemCount: 0,
    }).run();
    return id;
  }

  async completeJob(jobId: string, itemCount: number): Promise<void> {
    this.db
      .update(scrapeJobs)
      .set({ status: "completed", completedAt: Date.now(), itemCount })
      .where(eq(scrapeJobs.id, jobId))
      .run();
  }

  async failJob(jobId: string, errorMessage: string): Promise<void> {
    this.db
      .update(scrapeJobs)
      .set({ status: "failed", errorMessage })
      .where(eq(scrapeJobs.id, jobId))
      .run();
  }

  getLastSuccessfulRunByStore(store: string): number | null {
    const storeId = findStoreId(this.db, store);
    if (storeId === null) return null;
    const result = this.db
      .select({ completedAt: max(scrapeJobs.completedAt) })
      .from(scrapeJobs)
      .where(and(eq(scrapeJobs.storeId, storeId), eq(scrapeJobs.status, "completed")))
      .get();
    return result?.completedAt ?? null;
  }

  getStoresWithJobs(): string[] {
    const rows = this.db
      .selectDistinct({ store: stores.name })
      .from(scrapeJobs)
      .innerJoin(stores, eq(scrapeJobs.storeId, stores.id))
      .all();
    return rows.map((row) => row.store);
  }
}
