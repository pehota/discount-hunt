/**
 * CategorisationService unit tests — pure domain orchestration against fakes.
 *
 * Fakes: an in-memory DiscountCategoryStore (Map of id → row) and a recording
 * CategoryClassifier. The LLM classifies EVERYTHING (no rules). Asserts every
 * uncategorised row reaches the classifier, results are written, idempotency
 * (0 work on 2nd run), productType immutability, and the no-classifier
 * NULL-preserving (pending) path.
 */

import { describe, test, expect } from "bun:test";
import { CategorisationService } from "./categorisation-service.ts";
import type { CategoryClassifier, DiscountCategoryStore } from "./ports.ts";
import { TAXONOMY_CATEGORIES, type TaxonomyCategory } from "../shared/types.ts";

interface Row {
  name: string;
  productType: string;
  taxonomyCategory: TaxonomyCategory | null;
}

/** In-memory store. Mutates ONLY taxonomyCategory; productType is source-of-input. */
class FakeStore implements DiscountCategoryStore {
  private readonly rows = new Map<string, Row>();

  seed(id: string, name: string, productType: string): void {
    this.rows.set(id, { name, productType, taxonomyCategory: null });
  }

  get(id: string): Row | undefined {
    return this.rows.get(id);
  }

  findUncategorised(): { id: string; name: string; productType: string }[] {
    return [...this.rows.entries()]
      .filter(([, row]) => row.taxonomyCategory === null)
      .map(([id, row]) => ({ id, name: row.name, productType: row.productType }));
  }

  setTaxonomyCategory(id: string, cat: TaxonomyCategory): void {
    const row = this.rows.get(id);
    if (row) {
      row.taxonomyCategory = cat;
    }
  }
}

/** Records every classify call; returns a fixed bucket per input. */
class FakeClassifier implements CategoryClassifier {
  callCount = 0;
  writeCount = 0;
  lastInput: { name: string; productType: string }[] = [];

  constructor(private readonly bucket: TaxonomyCategory = "Other") {}

  async classify(items: { name: string; productType: string }[]): Promise<TaxonomyCategory[]> {
    this.callCount++;
    this.lastInput = items;
    this.writeCount += items.length;
    return items.map(() => this.bucket);
  }
}

describe("CategorisationService.run", () => {
  test("classifier receives ALL uncategorised rows; results written; all rows non-null after", async () => {
    const store = new FakeStore();
    store.seed("a", "Rindersteak", "Frischfleisch - Rind");
    store.seed("b", "Blattsalat", "Salate - Blattsalate");
    store.seed("c", "Mystery box", "unknown");
    const bucket: TaxonomyCategory = "Drinks";
    const classifier = new FakeClassifier(bucket);

    const service = new CategorisationService(store, classifier);
    const result = await service.run();

    expect(result.classified).toBe(3);
    expect(result.pending).toBe(0);

    // Classifier saw EVERY uncategorised row (name + productType), in one call.
    expect(classifier.callCount).toBe(1);
    expect(classifier.lastInput).toEqual([
      { name: "Rindersteak", productType: "Frischfleisch - Rind" },
      { name: "Blattsalat", productType: "Salate - Blattsalate" },
      { name: "Mystery box", productType: "unknown" },
    ]);

    // Every write is a valid taxonomy bucket.
    expect(TAXONOMY_CATEGORIES).toContain(bucket);
    expect(store.get("a")?.taxonomyCategory).toBe(bucket);
    expect(store.get("b")?.taxonomyCategory).toBe(bucket);
    expect(store.get("c")?.taxonomyCategory).toBe(bucket);
    expect(store.findUncategorised()).toHaveLength(0);
  });

  test("idempotency: a 2nd run after a fully-classified pass makes 0 classifier calls + 0 writes", async () => {
    const store = new FakeStore();
    store.seed("a", "Rindersteak", "Frischfleisch - Rind");
    store.seed("c", "Mystery box", "unknown");
    const classifier = new FakeClassifier("Drinks");
    const service = new CategorisationService(store, classifier);

    const first = await service.run();
    expect(first.classified).toBe(2);
    const callsAfterFirst = classifier.callCount;
    const writesAfterFirst = classifier.writeCount;
    const valuesAfterFirst = {
      a: store.get("a")?.taxonomyCategory,
      c: store.get("c")?.taxonomyCategory,
    };

    const second = await service.run();

    expect(classifier.callCount).toBe(callsAfterFirst); // 0 new classifier calls
    expect(classifier.writeCount).toBe(writesAfterFirst); // 0 new writes
    expect(second.classified).toBe(0);
    expect(second.pending).toBe(0);
    expect(store.get("a")?.taxonomyCategory).toBe(valuesAfterFirst.a);
    expect(store.get("c")?.taxonomyCategory).toBe(valuesAfterFirst.c);
  });

  test("productType (raw category) is never mutated by the service", async () => {
    const store = new FakeStore();
    store.seed("a", "Rindersteak", "Frischfleisch - Rind");
    store.seed("c", "Mystery box", "unknown");
    const service = new CategorisationService(store, new FakeClassifier("Drinks"));

    await service.run();

    expect(store.get("a")?.productType).toBe("Frischfleisch - Rind");
    expect(store.get("c")?.productType).toBe("unknown");
  });

  test("no classifier → all rows stay NULL (pending), classifier never called, never written", async () => {
    const store = new FakeStore();
    store.seed("a", "Blattsalat", "Salate - Blattsalate");
    store.seed("c", "Mystery box", "unknown");

    const service = new CategorisationService(store, null);
    const result = await service.run();

    expect(result.classified).toBe(0);
    expect(result.pending).toBe(2);

    expect(store.get("a")?.taxonomyCategory).toBeNull();
    expect(store.get("c")?.taxonomyCategory).toBeNull();
    expect(store.findUncategorised().map((r) => r.id)).toEqual(["a", "c"]);
  });

  test("no uncategorised rows → no classifier call, zero tallies", async () => {
    const store = new FakeStore();
    const classifier = new FakeClassifier("Drinks");
    const service = new CategorisationService(store, classifier);

    const result = await service.run();

    expect(result.classified).toBe(0);
    expect(result.pending).toBe(0);
    expect(classifier.callCount).toBe(0);
  });

  test("coalesces a missing (undefined) classifier result to 'Other'", async () => {
    const store = new FakeStore();
    store.seed("a", "Mystery box", "unknown");

    // Classifier returns a SHORTER array than inputs → row 'a' gets undefined.
    const shortClassifier: CategoryClassifier = {
      classify: async () => [],
    };
    const service = new CategorisationService(store, shortClassifier);

    const result = await service.run();

    expect(result.classified).toBe(1);
    expect(store.get("a")?.taxonomyCategory).toBe("Other");
  });
});
