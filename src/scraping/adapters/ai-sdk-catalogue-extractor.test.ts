/**
 * AiSdkCatalogueExtractor unit tests.
 *
 * Injects a MockLanguageModelV4 (ai/test) so no real LLM is hit. Verifies the
 * behaviour-preserving contract: model text containing a JSON array is mapped to
 * {name, regularPrice, salePrice}[]; text with no JSON array yields [].
 *
 * bypass: adapter mapping/parse tests are example-based (specific input→output),
 * not invariant-based — the parse boundary (JSON present / absent) is the property.
 */

import { describe, test, expect } from "bun:test";
import { MockLanguageModelV4 } from "ai/test";
import type { LanguageModelV4Usage } from "@ai-sdk/provider";
import { AiSdkCatalogueExtractor, EXTRACTION_PROMPT } from "./ai-sdk-catalogue-extractor.ts";

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

describe("AiSdkCatalogueExtractor", () => {
  test("maps a JSON-array response to product records", async () => {
    const responseText =
      'Here you go: [{"name":"Milk","regularPrice":"1.29","salePrice":"0.99"},' +
      '{"name":"Bread","regularPrice":"2.50","salePrice":"1.99"}] enjoy';
    const extractor = new AiSdkCatalogueExtractor(modelReturning(responseText));

    const result = await extractor.extractProducts(["p1", "p2"]);

    expect(result).toEqual([
      { name: "Milk", regularPrice: "1.29", salePrice: "0.99" },
      { name: "Bread", regularPrice: "2.50", salePrice: "1.99" },
    ]);
  });

  test("returns an empty array when the response contains no JSON array", async () => {
    const extractor = new AiSdkCatalogueExtractor(
      modelReturning("No products found in these paragraphs.")
    );

    const result = await extractor.extractProducts(["p1"]);

    expect(result).toEqual([]);
  });

  test("passes the extraction prompt and paragraphs to the model", async () => {
    const model = modelReturning("[]");
    const extractor = new AiSdkCatalogueExtractor(model);

    await extractor.extractProducts(["alpha", "beta"]);

    expect(model.doGenerateCalls).toHaveLength(1);
    // Inspect what actually reached the model: the standardized prompt must
    // carry the extraction instruction and every input paragraph.
    const sentPrompt = JSON.stringify(model.doGenerateCalls[0]?.prompt);
    expect(sentPrompt).toContain(EXTRACTION_PROMPT);
    expect(sentPrompt).toContain("alpha");
    expect(sentPrompt).toContain("beta");
  });
});
