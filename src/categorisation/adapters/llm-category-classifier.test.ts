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
import { LlmCategoryClassifier, CLASSIFICATION_PROMPT } from "./llm-category-classifier.ts";
import { isTaxonomyCategory } from "../../shared/types.ts";
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

const TWO_INPUTS = [
  { name: "Rind", productType: "unknown" },
  { name: "Cola", productType: "unknown" },
];

describe("LlmCategoryClassifier", () => {
  test("returns a clean array of valid buckets as-is", async () => {
    const classifier = new LlmCategoryClassifier(fakeLlm('["Meat & Fish","Drinks"]').llm);

    const result = await classifier.classify(TWO_INPUTS);

    expect(result).toEqual(["Meat & Fish", "Drinks"]);
    for (const bucket of result) {
      expect(isTaxonomyCategory(bucket)).toBe(true);
    }
  });

  test("coerces a bogus bucket to 'Other' and keeps valid siblings", async () => {
    const classifier = new LlmCategoryClassifier(fakeLlm('["Groceries","Drinks"]').llm);

    const result = await classifier.classify(TWO_INPUTS);

    expect(result).toEqual(["Other", "Drinks"]);
    for (const bucket of result) {
      expect(isTaxonomyCategory(bucket)).toBe(true);
    }
  });

  test("returns all 'Other' of the correct length when no JSON array is present", async () => {
    const classifier = new LlmCategoryClassifier(
      fakeLlm("I could not classify these products.").llm,
    );

    const result = await classifier.classify(TWO_INPUTS);

    expect(result).toEqual(["Other", "Other"]);
    expect(result).toHaveLength(TWO_INPUTS.length);
    for (const bucket of result) {
      expect(isTaxonomyCategory(bucket)).toBe(true);
    }
  });

  test("passes the classification prompt and inputs to the generator", async () => {
    const { calls, llm } = fakeLlm('["Other","Other"]');
    const classifier = new LlmCategoryClassifier(llm);

    await classifier.classify(TWO_INPUTS);

    expect(calls).toHaveLength(1);
    expect(calls[0]?.system).toBe(CLASSIFICATION_PROMPT);
    expect(calls[0]?.user).toContain("Cola");
  });
});
