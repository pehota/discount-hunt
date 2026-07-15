/**
 * CategorisationService unit tests — pure domain orchestration against fakes.
 *
 * Fakes: an in-memory DiscountCategoryStore (Map of id → row) and a recording
 * CategoryClassifier. Asserts rules/LLM split, idempotency (0 work on 2nd run),
 * productType immutability, and the no-classifier NULL-preserving path.
 */

import { describe, test, expect } from "bun:test";
import { CategorisationService } from "./categorisation-service.ts";
import { RulesClassifier } from "./rules-classifier.ts";
import type { CategoryClassifier, DiscountCategoryStore } from "./ports.ts";
import type { TaxonomyCategory } from "../shared/types.ts";

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
  lastInput: { name: string; productType: string }[] = [];

  constructor(private readonly bucket: TaxonomyCategory = "Other") {}

  async classify(items: { name: string; productType: string }[]): Promise<TaxonomyCategory[]> {
    this.callCount++;
    this.lastInput = items;
    return items.map(() => this.bucket);
  }
}

describe("CategorisationService.run", () => {
  test("rules classify keyword rows; classifier receives ONLY rules-null rows; all rows non-null after", async () => {
    const store = new FakeStore();
    store.seed("a", "Rindersteak", "Frischfleisch - Rind"); // rules → Meat & Fish
    store.seed("b", "Blattsalat", "Salate - Blattsalate"); // rules → Produce
    store.seed("c", "Mystery box", "unknown"); // rules null → LLM
    const classifier = new FakeClassifier("Drinks");

    const service = new CategorisationService(store, new RulesClassifier(), classifier);
    const result = await service.run();

    expect(result.rulesCount).toBe(2);
    expect(result.llmCount).toBe(1);
    expect(result.pendingCount).toBe(0);

    // Classifier saw ONLY the rules-null row.
    expect(classifier.callCount).toBe(1);
    expect(classifier.lastInput).toEqual([{ name: "Mystery box", productType: "unknown" }]);

    expect(store.get("a")?.taxonomyCategory).toBe("Meat & Fish");
    expect(store.get("b")?.taxonomyCategory).toBe("Produce");
    expect(store.get("c")?.taxonomyCategory).toBe("Drinks");
    expect(store.findUncategorised()).toHaveLength(0);
  });

  test("idempotency: a 2nd run after a fully-classified pass does zero new work", async () => {
    const store = new FakeStore();
    store.seed("a", "Rindersteak", "Frischfleisch - Rind");
    store.seed("c", "Mystery box", "unknown");
    const classifier = new FakeClassifier("Drinks");
    const service = new CategorisationService(store, new RulesClassifier(), classifier);

    await service.run();
    const callsAfterFirst = classifier.callCount;
    const valuesAfterFirst = {
      a: store.get("a")?.taxonomyCategory,
      c: store.get("c")?.taxonomyCategory,
    };

    const second = await service.run();

    expect(classifier.callCount).toBe(callsAfterFirst); // 0 new LLM calls
    expect(second.rulesCount).toBe(0);
    expect(second.llmCount).toBe(0);
    expect(second.pendingCount).toBe(0);
    expect(store.get("a")?.taxonomyCategory).toBe(valuesAfterFirst.a);
    expect(store.get("c")?.taxonomyCategory).toBe(valuesAfterFirst.c);
  });

  test("productType (raw category) is never mutated by the service", async () => {
    const store = new FakeStore();
    store.seed("a", "Rindersteak", "Frischfleisch - Rind");
    store.seed("c", "Mystery box", "unknown");
    const service = new CategorisationService(store, new RulesClassifier(), new FakeClassifier("Drinks"));

    await service.run();

    expect(store.get("a")?.productType).toBe("Frischfleisch - Rind");
    expect(store.get("c")?.productType).toBe("unknown");
  });

  test("no classifier + a rules-null row stays NULL (pendingCount), never written 'Other'", async () => {
    const store = new FakeStore();
    store.seed("a", "Blattsalat", "Salate - Blattsalate"); // rules → Produce
    store.seed("c", "Mystery box", "unknown"); // rules null → stays NULL

    const service = new CategorisationService(store, new RulesClassifier(), null);
    const result = await service.run();

    expect(result.rulesCount).toBe(1);
    expect(result.llmCount).toBe(0);
    expect(result.pendingCount).toBe(1);

    expect(store.get("a")?.taxonomyCategory).toBe("Produce");
    expect(store.get("c")?.taxonomyCategory).toBeNull();
    expect(store.findUncategorised().map((r) => r.id)).toEqual(["c"]);
  });
});
