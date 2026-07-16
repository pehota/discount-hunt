/**
 * LlmCatalogueExtractor unit tests.
 *
 * Injects a FAKE LlmTextGenerator (captures the two run() args, replays a canned
 * string) so no real LLM is hit. Verifies the behaviour-preserving contract:
 * model text containing a JSON array is mapped to {name, regularPrice, salePrice}[];
 * text with no JSON array yields []; and the EXTRACTION_PROMPT + paragraphs reach
 * the generator.
 *
 * bypass: adapter mapping/parse tests are example-based (specific input→output),
 * not invariant-based — the parse boundary (JSON present / absent) is the property.
 */

import { describe, test, expect } from "bun:test";
import { LlmCatalogueExtractor, EXTRACTION_PROMPT } from "./llm-catalogue-extractor.ts";
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

describe("LlmCatalogueExtractor", () => {
  test("maps a JSON-array response to product records", async () => {
    const responseText =
      'Here you go: [{"name":"Milk","regularPrice":"1.29","salePrice":"0.99"},' +
      '{"name":"Bread","regularPrice":"2.50","salePrice":"1.99"}] enjoy';
    const extractor = new LlmCatalogueExtractor(fakeLlm(responseText).llm);

    const result = await extractor.extractProducts(["p1", "p2"]);

    expect(result).toEqual([
      { name: "Milk", regularPrice: "1.29", salePrice: "0.99" },
      { name: "Bread", regularPrice: "2.50", salePrice: "1.99" },
    ]);
  });

  test("returns an empty array when the response contains no JSON array", async () => {
    const extractor = new LlmCatalogueExtractor(
      fakeLlm("No products found in these paragraphs.").llm,
    );

    const result = await extractor.extractProducts(["p1"]);

    expect(result).toEqual([]);
  });

  test("passes the extraction prompt and paragraphs to the generator", async () => {
    const { calls, llm } = fakeLlm("[]");
    const extractor = new LlmCatalogueExtractor(llm);

    await extractor.extractProducts(["alpha", "beta"]);

    expect(calls).toHaveLength(1);
    expect(calls[0]?.system).toBe(EXTRACTION_PROMPT);
    expect(calls[0]?.user).toContain("alpha");
    expect(calls[0]?.user).toContain("beta");
  });
});
