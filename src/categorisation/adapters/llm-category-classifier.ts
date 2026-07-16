/**
 * LlmCategoryClassifier — production adapter implementing CategoryClassifier.
 *
 * Provider-agnostic: delegates to any injected LlmTextGenerator (the concrete
 * provider is selected at wiring time; see src/llm/resolve-llm.ts). The LLM is
 * authoritative and classifies EVERY product (no keyword rules).
 *
 * Contract: output length ALWAYS equals input length. Each entry is
 * { category, tags }: a bucket outside the taxonomy is coerced to "Other"; tags
 * are filtered to known Tag values (unknowns dropped). No JSON array in the
 * response / parse fail / length mismatch → every entry { category:"Other", tags:[] }.
 *
 * Scaling: items are split into fixed-size chunks (CLASSIFY_CHUNK_SIZE) and each
 * chunk is a SEPARATE, SEQUENTIAL run() call (each backing subprocess is heavy).
 * Parse/coerce and the "all Other" fallback are applied PER CHUNK, so a single
 * malformed chunk response cannot silently turn the whole batch into "Other".
 */

import type { CategoryClassifier } from "../ports.ts";
import { TAXONOMY_CATEGORIES, isTaxonomyCategory, TAGS, isTag, type TaxonomyCategory, type Tag } from "../../shared/types.ts";
import type { LlmTextGenerator } from "../../llm/ports/llm-text-generator.ts";

/**
 * Single source of truth for the classification prompt. The category + tag lists
 * are built from TAXONOMY_CATEGORIES / TAGS (never a second hardcoded copy).
 */
export const CLASSIFICATION_PROMPT =
  "Classify each German supermarket product into exactly ONE of these categories: " +
  `${TAXONOMY_CATEGORIES.join(", ")}. ` +
  "Categorise by what the food fundamentally IS, NOT its storage temperature: " +
  "frozen fish → Meat & Fish, ice cream → Snacks & Sweets, frozen vegetables → Produce. " +
  `For each product ALSO list any of these tags that apply: ${TAGS.join(", ")}; ` +
  "frozen items get \"Frozen\", organic/Bio items \"Organic\", alcoholic drinks \"Alcoholic\", etc.; " +
  "use an empty array if none apply. " +
  "Return ONLY a JSON array of objects like {\"category\":\"...\",\"tags\":[\"...\"]} — " +
  "one per input product, same order.";

/**
 * Max products sent to the LLM in a single run() call. Larger batches produced
 * misaligned / unparseable responses at scale (a 108-item batch parsed as one
 * blob failed entirely). Chunking bounds each call and each fallback's blast
 * radius. Exported so tests derive chunk boundaries from it (no copied literal).
 */
export const CLASSIFY_CHUNK_SIZE = 25;

type Classification = { category: TaxonomyCategory; tags: Tag[] };

export class LlmCategoryClassifier implements CategoryClassifier {
  constructor(private readonly llm: LlmTextGenerator) {}

  async classify(items: { name: string; productType: string }[]): Promise<Classification[]> {
    const results: Classification[] = [];
    // Sequential, one run() per chunk — the backing subprocess is heavy, so we
    // must NOT fire chunks concurrently.
    for (let start = 0; start < items.length; start += CLASSIFY_CHUNK_SIZE) {
      const chunk = items.slice(start, start + CLASSIFY_CHUNK_SIZE);
      results.push(...(await this.classifyChunk(chunk)));
    }
    return results;
  }

  /** Classify ONE chunk. Always returns exactly chunk.length entries. */
  private async classifyChunk(chunk: { name: string; productType: string }[]): Promise<Classification[]> {
    const userContent = chunk
      .map((item, i) => `${i + 1}. name="${item.name}" productType="${item.productType}"`)
      .join("\n");

    const text = await this.llm.run(CLASSIFICATION_PROMPT, userContent);

    // Fallback is scoped to THIS chunk only — bounds the blast radius of a bad
    // response so one malformed chunk can't turn the whole batch into "Other".
    const fallback = (): Classification[] =>
      chunk.map(() => ({ category: "Other" as TaxonomyCategory, tags: [] as Tag[] }));

    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      return fallback();
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonMatch[0]);
    } catch {
      return fallback();
    }

    if (!Array.isArray(parsed) || parsed.length !== chunk.length) {
      return fallback();
    }

    // Coerce each entry: valid bucket kept, anything else → "Other"; tags filtered
    // to known Tag values. Non-object / null entries → { "Other", [] }.
    return parsed.map((entry) => {
      if (typeof entry !== "object" || entry === null) {
        return { category: "Other" as TaxonomyCategory, tags: [] as Tag[] };
      }
      const record = entry as { category?: unknown; tags?: unknown };
      const category: TaxonomyCategory =
        typeof record.category === "string" && isTaxonomyCategory(record.category)
          ? record.category
          : "Other";
      const tags: Tag[] = Array.isArray(record.tags)
        ? record.tags.filter((t): t is Tag => typeof t === "string" && isTag(t))
        : [];
      return { category, tags };
    });
  }
}
