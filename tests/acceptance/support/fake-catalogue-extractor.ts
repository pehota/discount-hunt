/**
 * FakeCatalogueExtractor — in-memory double for the CatalogueExtractor port.
 *
 * Used in tests to avoid calling the Anthropic API.
 * Records the last paragraphs received via `lastParagraphs` for assertion.
 */

import type { CatalogueExtractor } from "../../../src/scraping/adapters/catalogue-extractor.ts";

export class FakeCatalogueExtractor implements CatalogueExtractor {
  /** The last paragraphs array passed to extractProducts() — available for assertion. */
  public lastParagraphs: string[] = [];

  constructor(
    private fixture: Array<{
      name: string;
      regularPrice: string;
      salePrice: string;
    }> = [
      { name: "Bio Haferflocken 500g", regularPrice: "2.29", salePrice: "1.49" },
      { name: "Rote Linsen 400g", regularPrice: "1.99", salePrice: "1.19" },
    ]
  ) {}

  async extractProducts(
    paragraphs: string[]
  ): Promise<Array<{ name: string; regularPrice: string; salePrice: string }>> {
    this.lastParagraphs = paragraphs;
    return this.fixture;
  }
}
