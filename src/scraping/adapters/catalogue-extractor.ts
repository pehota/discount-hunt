/**
 * CatalogueExtractor — driven port (outbound from VMarktCatalogueFetcher to LLM).
 *
 * Implementations: HaikuCatalogueExtractor (production), FakeCatalogueExtractor (tests).
 */

export interface CatalogueExtractor {
  extractProducts(
    paragraphs: string[]
  ): Promise<Array<{ name: string; regularPrice: string; salePrice: string }>>;
}
