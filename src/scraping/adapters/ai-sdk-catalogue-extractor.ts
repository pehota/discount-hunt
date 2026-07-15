/**
 * AiSdkCatalogueExtractor — production adapter implementing CatalogueExtractor.
 *
 * Provider-agnostic: delegates to any Vercel AI SDK LanguageModel (Anthropic,
 * OpenAI-compatible, local, …) injected via the constructor. The concrete model
 * is selected at wiring time (see catalogue-llm-config.ts). Behaviour-preserving
 * relative to the former Haiku adapter: same EXTRACTION_PROMPT, same text→JSON
 * parse (`/\[[\s\S]*\]/` → JSON.parse, empty array on no match).
 */

import { generateText, type LanguageModel } from "ai";
import type { CatalogueExtractor } from "./catalogue-extractor.ts";

/** Single source of truth for the catalogue-extraction prompt. */
export const EXTRACTION_PROMPT =
  "Extract German supermarket products from these catalogue paragraphs. " +
  "Return JSON array: [{name, regularPrice, salePrice}] where prices are numeric strings like '1.29'. " +
  "Only include products where a discount (salePrice < regularPrice) is clearly indicated.";

export class AiSdkCatalogueExtractor implements CatalogueExtractor {
  constructor(private readonly model: LanguageModel) {}

  async extractProducts(
    paragraphs: string[]
  ): Promise<Array<{ name: string; regularPrice: string; salePrice: string }>> {
    const userContent = paragraphs.join("\n\n");
    const { text } = await generateText({
      model: this.model,
      prompt: `${EXTRACTION_PROMPT}\n\n${userContent}`,
    });

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
