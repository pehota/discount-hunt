/**
 * categoriser-runner unit test — wiring of the testable runCategorisation factory.
 *
 * Injects a fake store + fake classifier + recording logger so no real DB/LLM is
 * hit. Asserts the run completes, drains uncategorised rows, and logs the summary.
 */

import { describe, test, expect } from "bun:test";
import { runCategorisation } from "./categoriser-runner.ts";
import type { CategoryClassifier, DiscountCategoryStore } from "./ports.ts";
import type { TaxonomyCategory, Tag } from "../shared/types.ts";
import type { LogLevel, Logger } from "../shared/logger.ts";

class FakeStore implements DiscountCategoryStore {
  private readonly rows = new Map<string, { name: string; productType: string; cat: TaxonomyCategory | null; tags: Tag[] }>();
  seed(id: string, name: string, productType: string): void {
    this.rows.set(id, { name, productType, cat: null, tags: [] });
  }
  findUncategorised(): { id: string; name: string; productType: string }[] {
    return [...this.rows.entries()]
      .filter(([, r]) => r.cat === null)
      .map(([id, r]) => ({ id, name: r.name, productType: r.productType }));
  }
  setCategorisation(id: string, category: TaxonomyCategory, tags: Tag[]): void {
    const r = this.rows.get(id);
    if (r) { r.cat = category; r.tags = tags; }
  }
}

class FakeClassifier implements CategoryClassifier {
  async classify(items: { name: string; productType: string }[]): Promise<{ category: TaxonomyCategory; tags: Tag[] }[]> {
    return items.map(() => ({ category: "Other", tags: [] }));
  }
}

class RecordingLogger implements Logger {
  events: { level: LogLevel; event: string; fields?: Record<string, unknown> }[] = [];
  log(level: LogLevel, event: string, fields?: Record<string, unknown>): void {
    this.events.push({ level, event, ...(fields ? { fields } : {}) });
  }
}

describe("runCategorisation", () => {
  test("completes, classifies all rows via the LLM, and logs the summary", async () => {
    const store = new FakeStore();
    store.seed("a", "Blattsalat", "Salate - Blattsalate");
    store.seed("c", "Mystery", "unknown");
    const logger = new RecordingLogger();

    const result = await runCategorisation({ store, classifier: new FakeClassifier(), logger });

    expect(result.classified).toBe(2);
    expect(result.pending).toBe(0);
    expect(store.findUncategorised()).toHaveLength(0);

    const summary = logger.events.find((e) => e.event === "categorise.run.done");
    expect(summary).toBeDefined();
    expect(summary?.fields).toMatchObject({ classified: 2, pending: 0 });
  });
});
