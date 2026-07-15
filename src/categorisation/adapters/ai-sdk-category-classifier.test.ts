/**
 * AiSdkCategoryClassifier unit tests.
 *
 * Injects a MockLanguageModelV4 (ai/test) — no real LLM is hit. Verifies:
 *   - a clean JSON array of valid buckets is returned as-is,
 *   - a bogus bucket is coerced to "Other" while valid siblings are kept,
 *   - a response with no JSON array yields all "Other" of the correct length,
 *   - every output ∈ TAXONOMY_CATEGORIES.
 *
 * bypass: adapter parse/coerce tests are example-based (specific input→output).
 */

import { describe, test, expect } from "bun:test";
import { MockLanguageModelV4 } from "ai/test";
import type { LanguageModelV4Usage } from "@ai-sdk/provider";
import { AiSdkCategoryClassifier, CLASSIFICATION_PROMPT } from "./ai-sdk-category-classifier.ts";
import { isTaxonomyCategory } from "../../shared/types.ts";

const ZERO_USAGE: LanguageModelV4Usage = {
  inputTokens: { total: 0, noCache: 0, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 0, text: 0, reasoning: 0 },
};

/** Builds a mock model whose single generation returns the given text. */
function modelReturning(text: string): MockLanguageModelV4 {
  return new MockLanguageModelV4({
    doGenerate: async () => ({
      finishReason: { unified: "stop", raw: "stop" },
      usage: ZERO_USAGE,
      content: [{ type: "text", text }],
      warnings: [],
    }),
  });
}

const TWO_INPUTS = [
  { name: "Rind", productType: "unknown" },
  { name: "Cola", productType: "unknown" },
];

describe("AiSdkCategoryClassifier", () => {
  test("returns a clean array of valid buckets as-is", async () => {
    const classifier = new AiSdkCategoryClassifier(
      modelReturning('["Meat & Fish","Drinks"]'),
    );

    const result = await classifier.classify(TWO_INPUTS);

    expect(result).toEqual(["Meat & Fish", "Drinks"]);
    for (const bucket of result) {
      expect(isTaxonomyCategory(bucket)).toBe(true);
    }
  });

  test("coerces a bogus bucket to 'Other' and keeps valid siblings", async () => {
    const classifier = new AiSdkCategoryClassifier(
      modelReturning('["Groceries","Drinks"]'),
    );

    const result = await classifier.classify(TWO_INPUTS);

    expect(result).toEqual(["Other", "Drinks"]);
    for (const bucket of result) {
      expect(isTaxonomyCategory(bucket)).toBe(true);
    }
  });

  test("returns all 'Other' of the correct length when no JSON array is present", async () => {
    const classifier = new AiSdkCategoryClassifier(
      modelReturning("I could not classify these products."),
    );

    const result = await classifier.classify(TWO_INPUTS);

    expect(result).toEqual(["Other", "Other"]);
    expect(result).toHaveLength(TWO_INPUTS.length);
    for (const bucket of result) {
      expect(isTaxonomyCategory(bucket)).toBe(true);
    }
  });

  test("passes the classification prompt and inputs to the model", async () => {
    const model = modelReturning('["Other","Other"]');
    const classifier = new AiSdkCategoryClassifier(model);

    await classifier.classify(TWO_INPUTS);

    expect(model.doGenerateCalls).toHaveLength(1);
    // Inspect the actual text the model received. The prompt embeds double
    // quotes (Use "Other"…), so assert on the raw text field rather than the
    // JSON-stringified form (which would escape those quotes and never match).
    const promptMessages = model.doGenerateCalls[0]?.prompt ?? [];
    const sentText = JSON.stringify(promptMessages.map((m) => m.content));
    // A quote-free, distinctive fragment of CLASSIFICATION_PROMPT + the input.
    expect(sentText).toContain("Classify each German supermarket product");
    expect(sentText).toContain("Cola");
    // The whole prompt const is genuinely present in the sent text.
    expect(promptMessages.some((m) =>
      JSON.stringify(m.content).replace(/\\"/g, '"').includes(CLASSIFICATION_PROMPT),
    )).toBe(true);
  });
});
