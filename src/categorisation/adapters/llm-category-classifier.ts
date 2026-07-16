/**
 * LlmCategoryClassifier — production adapter implementing CategoryClassifier.
 *
 * Provider-agnostic: delegates to any injected LlmTextGenerator (the concrete
 * provider is selected at wiring time; see src/llm/resolve-llm.ts). The LLM is
 * authoritative and classifies EVERY product (no keyword rules).
 *
 * Contract: output length ALWAYS equals input length (pad/truncate with "Other").
 * Any parsed bucket outside the taxonomy is coerced to "Other". No JSON array in
 * the response → all "Other".
 */

import type { CategoryClassifier } from "../ports.ts";
import { TAXONOMY_CATEGORIES, isTaxonomyCategory, type TaxonomyCategory } from "../../shared/types.ts";
import type { LlmTextGenerator } from "../../llm/ports/llm-text-generator.ts";

/**
 * Single source of truth for the classification prompt. The bucket list is built
 * from TAXONOMY_CATEGORIES (never a second hardcoded copy).
 */
export const CLASSIFICATION_PROMPT =
  "Classify each German supermarket product into exactly ONE of these categories: " +
  `${TAXONOMY_CATEGORIES.join(", ")}. ` +
  "Categorise by what the food fundamentally IS, NOT its storage temperature: " +
  "frozen fish → Meat & Fish, ice cream → Snacks & Sweets, frozen vegetables → Produce. " +
  "Return ONLY a JSON array of category strings — one entry per input product, in the " +
  "same order as the inputs. Use \"Other\" when no category fits.";

export class LlmCategoryClassifier implements CategoryClassifier {
  constructor(private readonly llm: LlmTextGenerator) {}

  async classify(items: { name: string; productType: string }[]): Promise<TaxonomyCategory[]> {
    const userContent = items
      .map((item, i) => `${i + 1}. name="${item.name}" productType="${item.productType}"`)
      .join("\n");

    const text = await this.llm.run(CLASSIFICATION_PROMPT, userContent);

    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      return items.map(() => "Other");
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonMatch[0]);
    } catch {
      return items.map(() => "Other");
    }

    if (!Array.isArray(parsed) || parsed.length !== items.length) {
      return items.map(() => "Other");
    }

    // Coerce each entry: valid bucket kept, anything else → "Other".
    return parsed.map((value) =>
      typeof value === "string" && isTaxonomyCategory(value) ? value : "Other",
    );
  }
}
