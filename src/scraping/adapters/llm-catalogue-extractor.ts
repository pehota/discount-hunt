/**
 * LlmCatalogueExtractor — production adapter implementing CatalogueExtractor.
 *
 * Provider-agnostic: delegates to any injected LlmTextGenerator (the concrete
 * provider is selected at wiring time; see src/llm/resolve-llm.ts). Behaviour-
 * preserving: same EXTRACTION_PROMPT, same text→JSON parse (`/\[[\s\S]*\]/` →
 * JSON.parse, empty array on no match).
 */

import type { CatalogueExtractor } from "./catalogue-extractor.ts";
import type { LlmTextGenerator } from "../../llm/ports/llm-text-generator.ts";

/** Single source of truth for the catalogue-extraction prompt. */
export const EXTRACTION_PROMPT =
  "Extract German supermarket products from these catalogue paragraphs. " +
  "Return JSON array: [{name, regularPrice, salePrice}] where prices are numeric strings like '1.29'. " +
  "Only include products where a discount (salePrice < regularPrice) is clearly indicated.";

export class LlmCatalogueExtractor implements CatalogueExtractor {
  constructor(private readonly llm: LlmTextGenerator) {}

  async extractProducts(
    paragraphs: string[]
  ): Promise<Array<{ name: string; regularPrice: string; salePrice: string }>> {
    const text = await this.llm.run(EXTRACTION_PROMPT, paragraphs.join("\n\n"));

    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      return [];
    }

    return JSON.parse(jsonMatch[0]) as Array<{
      name: string;
      regularPrice: string;
      salePrice: string;
    }>;
  }
}
