/**
 * CategorisationService — domain service orchestrating hybrid categorisation.
 *
 * Flow: rules first (cheap, deterministic) → LLM fallback for the remainder.
 * NULL-only processing makes runs idempotent: already-classified rows are never
 * revisited, so a re-run after a fully-classified pass does zero work.
 *
 * Depends ONLY on port types + the pure RulesClassifier — never on adapters.
 */

import type { CategoryClassifier, DiscountCategoryStore } from "./ports.ts";
import { RulesClassifier } from "./rules-classifier.ts";

/** Per-run tally. pendingCount = rows left NULL (no classifier, rules missed). */
export interface CategorisationResult {
  rulesCount: number;
  llmCount: number;
  pendingCount: number;
}

export class CategorisationService {
  constructor(
    private readonly store: DiscountCategoryStore,
    private readonly rules: RulesClassifier,
    private readonly classifier: CategoryClassifier | null,
  ) {}

  async run(): Promise<CategorisationResult> {
    // NULL-only → idempotent: classified rows are excluded by the port query.
    const rows = this.store.findUncategorised();

    let rulesCount = 0;
    const deferred: { id: string; name: string; productType: string }[] = [];

    for (const row of rows) {
      const bucket = this.rules.classify(row.productType);
      if (bucket !== null) {
        this.store.setTaxonomyCategory(row.id, bucket);
        rulesCount++;
      } else {
        deferred.push(row);
      }
    }

    let llmCount = 0;

    // Only call the LLM when there is a classifier AND something to classify
    // (guard against classify([])).
    if (this.classifier !== null && deferred.length > 0) {
      const buckets = await this.classifier.classify(
        deferred.map((row) => ({ name: row.name, productType: row.productType })),
      );
      for (let i = 0; i < deferred.length; i++) {
        const row = deferred[i]!;
        // noUncheckedIndexedAccess: buckets[i] is TaxonomyCategory | undefined.
        const cat = buckets[i] ?? "Other";
        this.store.setTaxonomyCategory(row.id, cat);
        llmCount++;
      }
    }

    // No classifier → deferred rows stay NULL (never written "Other").
    const pendingCount = this.classifier === null ? deferred.length : 0;

    return { rulesCount, llmCount, pendingCount };
  }
}
