/**
 * CategorisationService — domain service orchestrating categorisation.
 *
 * Flow: the LLM classifier is authoritative for EVERY uncategorised item. NULL-only
 * processing makes runs idempotent: already-classified rows are never revisited, so
 * a re-run after a fully-classified pass does zero work (no classifier call).
 *
 * Depends ONLY on port types — never on concrete adapters.
 */

import type { CategoryClassifier, DiscountCategoryStore } from "./ports.ts";

/** Per-run tally. pending = rows left NULL (no classifier configured). */
export interface CategorisationResult {
  classified: number;
  pending: number;
}

export class CategorisationService {
  constructor(
    private readonly store: DiscountCategoryStore,
    private readonly classifier: CategoryClassifier | null,
  ) {}

  async run(): Promise<CategorisationResult> {
    // NULL-only → idempotent: classified rows are excluded by the port query.
    const rows = this.store.findUncategorised();

    if (rows.length === 0) {
      return { classified: 0, pending: 0 };
    }

    // No classifier → leave rows NULL (never written "Other").
    if (this.classifier === null) {
      return { classified: 0, pending: rows.length };
    }

    const cats = await this.classifier.classify(
      rows.map((row) => ({ name: row.name, productType: row.productType })),
    );

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]!;
      // noUncheckedIndexedAccess: cats[i] is TaxonomyCategory | undefined.
      this.store.setTaxonomyCategory(row.id, cats[i] ?? "Other");
    }

    return { classified: rows.length, pending: 0 };
  }
}
