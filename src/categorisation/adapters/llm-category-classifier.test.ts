/**
 * LlmCategoryClassifier unit tests.
 *
 * Injects a FAKE LlmTextGenerator (captures the two run() args, replays a canned
 * string) — no real LLM is hit. Verifies:
 *   - a clean JSON array of valid buckets is returned as-is,
 *   - a bogus bucket is coerced to "Other" while valid siblings are kept,
 *   - a response with no JSON array yields all "Other" of the correct length,
 *   - the CLASSIFICATION_PROMPT + numbered inputs reach the generator,
 *   - every output ∈ TAXONOMY_CATEGORIES.
 *
 * bypass: adapter parse/coerce tests are example-based (specific input→output).
 */

import { describe, test, expect } from "bun:test";
import { LlmCategoryClassifier, CLASSIFICATION_PROMPT, CLASSIFY_CHUNK_SIZE } from "./llm-category-classifier.ts";
import { TAXONOMY_CATEGORIES, TAGS, isTaxonomyCategory } from "../../shared/types.ts";
import type { LlmTextGenerator } from "../../llm/ports/llm-text-generator.ts";

/** A fake generator that records its two run() args and replays a canned string. */
function fakeLlm(response: string) {
  const calls: Array<{ system: string; user: string }> = [];
  const llm: LlmTextGenerator = {
    run: async (system, user) => {
      calls.push({ system, user });
      return response;
    },
  };
  return { calls, llm };
}

/**
 * A fake generator that records each call and replays one canned response PER
 * call (in order). Throws if invoked more times than there are responses — that
 * surfaces a mis-sized test instead of silently feeding empty strings.
 */
function sequentialFakeLlm(responses: string[]) {
  const calls: Array<{ system: string; user: string }> = [];
  const llm: LlmTextGenerator = {
    run: async (system, user) => {
      const response = responses[calls.length];
      if (response === undefined) {
        throw new Error(`unexpected run() call #${calls.length + 1}; only ${responses.length} responses provided`);
      }
      calls.push({ system, user });
      return response;
    },
  };
  return { calls, llm };
}

const TWO_INPUTS = [
  { name: "Rind", productType: "unknown" },
  { name: "Cola", productType: "unknown" },
];

describe("LlmCategoryClassifier", () => {
  test("maps a clean array of {category,tags} objects as-is", async () => {
    const classifier = new LlmCategoryClassifier(
      fakeLlm('[{"category":"Meat & Fish","tags":["Frozen"]},{"category":"Drinks","tags":["Alcoholic"]}]').llm,
    );

    const result = await classifier.classify(TWO_INPUTS);

    expect(result).toEqual([
      { category: "Meat & Fish", tags: ["Frozen"] },
      { category: "Drinks", tags: ["Alcoholic"] },
    ]);
    for (const entry of result) {
      expect(isTaxonomyCategory(entry.category)).toBe(true);
    }
  });

  test("coerces a bogus bucket to 'Other' and keeps valid siblings", async () => {
    const classifier = new LlmCategoryClassifier(
      fakeLlm('[{"category":"Groceries","tags":[]},{"category":"Drinks","tags":[]}]').llm,
    );

    const result = await classifier.classify(TWO_INPUTS);

    expect(result).toEqual([
      { category: "Other", tags: [] },
      { category: "Drinks", tags: [] },
    ]);
  });

  test("drops invalid tag values, keeps valid ones", async () => {
    const classifier = new LlmCategoryClassifier(
      fakeLlm('[{"category":"Produce","tags":["Organic","Bogus",123]},{"category":"Drinks","tags":[]}]').llm,
    );

    const result = await classifier.classify(TWO_INPUTS);

    expect(result[0]).toEqual({ category: "Produce", tags: ["Organic"] });
    expect(result[1]).toEqual({ category: "Drinks", tags: [] });
  });

  test("returns all {category:'Other',tags:[]} of the correct length when no JSON array is present", async () => {
    const classifier = new LlmCategoryClassifier(
      fakeLlm("I could not classify these products.").llm,
    );

    const result = await classifier.classify(TWO_INPUTS);

    expect(result).toEqual([
      { category: "Other", tags: [] },
      { category: "Other", tags: [] },
    ]);
    expect(result).toHaveLength(TWO_INPUTS.length);
  });

  test("passes the classification prompt and inputs to the generator", async () => {
    const { calls, llm } = fakeLlm('[{"category":"Other","tags":[]},{"category":"Other","tags":[]}]');
    const classifier = new LlmCategoryClassifier(llm);

    await classifier.classify(TWO_INPUTS);

    expect(calls).toHaveLength(1);
    expect(calls[0]?.system).toBe(CLASSIFICATION_PROMPT);
    expect(calls[0]?.user).toContain("Cola");
  });

  test("prompt is built from the SSOT taxonomy + tags and carries the food-type instruction", async () => {
    // Category + tag lists are single-sourced from the SSOTs (no copied literals).
    expect(CLASSIFICATION_PROMPT).toContain(TAXONOMY_CATEGORIES.join(", "));
    expect(CLASSIFICATION_PROMPT).toContain(TAGS.join(", "));
    // Categorise by what the food fundamentally IS, not its storage temperature.
    expect(CLASSIFICATION_PROMPT).toContain("fundamentally");
    expect(CLASSIFICATION_PROMPT).toContain("frozen fish");
  });

  test("empty input returns [] with zero run() calls", async () => {
    const { calls, llm } = sequentialFakeLlm([]);
    const classifier = new LlmCategoryClassifier(llm);

    const result = await classifier.classify([]);

    expect(result).toEqual([]);
    expect(calls).toHaveLength(0);
  });

  test("chunks a large batch into ceil(n/size) sequential calls, concatenated in input order", async () => {
    const n = CLASSIFY_CHUNK_SIZE * 2 + 3; // 3 chunks: [size, size, 3]

    // Distinct categories per chunk so position→category proves ordering.
    const chunkCategory = ["Produce", "Drinks", "Bakery"] as const;
    const items = Array.from({ length: n }, (_, i) => ({
      name: `item-${i}`,
      productType: "unknown",
    }));

    // One canned response per chunk, each sized to ITS chunk (derived from source).
    const responses: string[] = [];
    for (let start = 0; start < n; start += CLASSIFY_CHUNK_SIZE) {
      const size = Math.min(CLASSIFY_CHUNK_SIZE, n - start);
      const category = chunkCategory[start / CLASSIFY_CHUNK_SIZE];
      if (category === undefined) throw new Error("test setup: more chunks than canned categories");
      responses.push(
        JSON.stringify(Array.from({ length: size }, () => ({ category, tags: [] }))),
      );
    }

    const { calls, llm } = sequentialFakeLlm(responses);
    const classifier = new LlmCategoryClassifier(llm);

    const result = await classifier.classify(items);

    expect(calls).toHaveLength(Math.ceil(n / CLASSIFY_CHUNK_SIZE));
    expect(result).toHaveLength(n);
    // Positions map back to their chunk's category → order preserved.
    for (let i = 0; i < n; i++) {
      const expected = chunkCategory[Math.floor(i / CLASSIFY_CHUNK_SIZE)];
      if (expected === undefined) throw new Error("test setup: index outside canned categories");
      expect(result[i]).toEqual({ category: expected, tags: [] });
    }
  });

  test("per-chunk fallback isolation: a bad chunk becomes all 'Other' without poisoning good chunks", async () => {
    const n = CLASSIFY_CHUNK_SIZE * 2; // exactly 2 full chunks
    const items = Array.from({ length: n }, (_, i) => ({
      name: `item-${i}`,
      productType: "unknown",
    }));

    const chunk1Response = JSON.stringify(
      Array.from({ length: CLASSIFY_CHUNK_SIZE }, () => ({ category: "Produce", tags: ["Organic"] })),
    );
    const chunk2Garbage = "sorry, I cannot classify these"; // no JSON array → chunk-2 fallback

    const { llm } = sequentialFakeLlm([chunk1Response, chunk2Garbage]);
    const classifier = new LlmCategoryClassifier(llm);

    const result = await classifier.classify(items);

    expect(result).toHaveLength(n);
    // Chunk 1 keeps its real categories/tags.
    for (let i = 0; i < CLASSIFY_CHUNK_SIZE; i++) {
      expect(result[i]).toEqual({ category: "Produce", tags: ["Organic"] });
    }
    // ONLY chunk 2 fell back to Other.
    for (let i = CLASSIFY_CHUNK_SIZE; i < n; i++) {
      expect(result[i]).toEqual({ category: "Other", tags: [] });
    }
  });
});
