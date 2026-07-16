/**
 * Categorisation context — driven port declarations (interfaces only, no logic).
 *
 * Hexagonal boundary: CategorisationService depends on these abstractions; the
 * SQLite repo and the AI-SDK classifier are the concrete adapters that implement
 * them at wiring time.
 */

import type { TaxonomyCategory, Tag } from "../shared/types.ts";

/**
 * Driven port — an LLM (or any) classifier that maps products to a single
 * food-type bucket PLUS zero-or-more cross-cutting tags, in ONE call. Output is
 * order-aligned with input and MUST have the same length.
 */
export interface CategoryClassifier {
  classify(items: { name: string; productType: string }[]): Promise<{ category: TaxonomyCategory; tags: Tag[] }[]>;
}

/**
 * Driven port — the persistence side the service reads uncategorised rows from
 * and writes classified buckets + tags back to. Implemented by the discount_items
 * repo (single writer of that table).
 *
 * `productType` is the raw German source category (DB `category` column), used
 * as classifier INPUT. `setCategorisation` writes the OUTPUT bucket + tags.
 */
export interface DiscountCategoryStore {
  findUncategorised(): { id: string; name: string; productType: string }[];
  setCategorisation(id: string, category: TaxonomyCategory, tags: Tag[]): void;
}
