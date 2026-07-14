/**
 * HaikuCatalogueExtractor — production adapter implementing CatalogueExtractor.
 *
 * Delegates to claude-haiku-4-5-20251001 via the Anthropic SDK to extract
 * product data from German supermarket catalogue paragraph strings.
 */

import Anthropic from "@anthropic-ai/sdk";
import type { CatalogueExtractor } from "./catalogue-extractor.ts";

const MODEL = "claude-haiku-4-5-20251001";
const EXTRACTION_PROMPT =
  "Extract German supermarket products from these catalogue paragraphs. " +
  "Return JSON array: [{name, regularPrice, salePrice}] where prices are numeric strings like '1.29'. " +
  "Only include products where a discount (salePrice < regularPrice) is clearly indicated.";

export class HaikuCatalogueExtractor implements CatalogueExtractor {
  private client: Anthropic;

  constructor() {
    this.client = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    });
  }

  async extractProducts(
    paragraphs: string[]
  ): Promise<Array<{ name: string; regularPrice: string; salePrice: string }>> {
    const userContent = paragraphs.join("\n\n");
    const response = await this.client.messages.create({
      model: MODEL,
      max_tokens: 4096,
      messages: [
        {
          role: "user",
          content: `${EXTRACTION_PROMPT}\n\n${userContent}`,
        },
      ],
    });

    const text = response.content
      .filter((block) => block.type === "text")
      .map((block) => (block as { type: "text"; text: string }).text)
      .join("");

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
