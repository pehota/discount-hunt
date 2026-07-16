/**
 * OpenRouterTextGenerator unit tests.
 *
 * Injects a MockLanguageModelV4 (ai/test) so no real HTTP call is made. Verifies:
 *   - both the system prompt and the user prompt reach the model,
 *   - the model's `.text` is returned.
 *
 * bypass: adapter delegation test is example-based (specific input→output).
 */

import { describe, test, expect } from "bun:test";
import { MockLanguageModelV4 } from "ai/test";
import type { LanguageModelV4Usage } from "@ai-sdk/provider";
import { OpenRouterTextGenerator } from "./openrouter-text-generator.ts";

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

describe("OpenRouterTextGenerator", () => {
  test("passes system and user prompts to the model and returns its text", async () => {
    const model = modelReturning("generated-text");
    const gen = new OpenRouterTextGenerator(model);

    const result = await gen.run("SYSTEM-PROMPT", "USER-PROMPT");

    expect(result).toBe("generated-text");
    expect(model.doGenerateCalls).toHaveLength(1);
    // The AI SDK forwards `system` + `prompt` as messages; both must reach the
    // model. Inspect the serialized prompt (which carries the system message too).
    const sentPrompt = JSON.stringify(model.doGenerateCalls[0]?.prompt);
    expect(sentPrompt).toContain("SYSTEM-PROMPT");
    expect(sentPrompt).toContain("USER-PROMPT");
  });
});
