/**
 * resolve-llm — resolves the one LlmTextGenerator from a single env switch.
 *
 * ONE port, TWO adapters, NO fallbacks. LLM_PROVIDER selects:
 *   - "claude-cli" → ClaudeCliTextGenerator (dev; local `claude` CLI, no API key).
 *                    Optional CLAUDE_CLI_MODEL picks the model id.
 *   - "openrouter" → OpenRouterTextGenerator (prod). Requires BOTH
 *                    OPENROUTER_API_KEY and OPENROUTER_MODEL; either missing → null.
 *   - anything else / unset → null (= LLM off; rules-only, no V-Markt).
 */

import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LlmTextGenerator } from "./ports/llm-text-generator.ts";
import { ClaudeCliTextGenerator } from "./adapters/claude-cli-text-generator.ts";
import { OpenRouterTextGenerator } from "./adapters/openrouter-text-generator.ts";

/** Recorded reason when a consumer's LLM leg is skipped due to no usable config. */
export const LLM_NOT_CONFIGURED = "catalogue LLM not configured";

const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

export function resolveLlm(
  env: Record<string, string | undefined> = process.env,
): LlmTextGenerator | null {
  const provider = env.LLM_PROVIDER;

  switch (provider) {
    case "claude-cli":
      return new ClaudeCliTextGenerator({ model: env.CLAUDE_CLI_MODEL });
    case "openrouter": {
      const apiKey = env.OPENROUTER_API_KEY;
      const model = env.OPENROUTER_MODEL;
      if (!apiKey || !model) {
        return null;
      }
      const languageModel = createOpenAICompatible({
        name: "openrouter",
        baseURL: OPENROUTER_BASE_URL,
        apiKey,
      })(model);
      return new OpenRouterTextGenerator(languageModel);
    }
    default:
      return null;
  }
}
