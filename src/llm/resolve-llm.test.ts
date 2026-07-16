/**
 * resolveLlm unit tests — hermetic, explicit env objects (never process.env).
 *
 * Verifies the single-switch provider resolution:
 *   - LLM_PROVIDER=claude-cli  → a ClaudeCliTextGenerator (construction only, no spawn),
 *   - LLM_PROVIDER=openrouter  → an OpenRouterTextGenerator when BOTH key + model set,
 *   - openrouter missing key OR missing model → null,
 *   - unset / unknown provider → null.
 *
 * bypass: factory-branch tests are example-based (specific env→instance/null).
 */

import { describe, test, expect } from "bun:test";
import { resolveLlm } from "./resolve-llm.ts";
import { ClaudeCliTextGenerator } from "./adapters/claude-cli-text-generator.ts";
import { OpenRouterTextGenerator } from "./adapters/openrouter-text-generator.ts";

describe("resolveLlm", () => {
  test("claude-cli → a ClaudeCliTextGenerator instance", () => {
    const llm = resolveLlm({ LLM_PROVIDER: "claude-cli" });
    expect(llm).toBeInstanceOf(ClaudeCliTextGenerator);
  });

  test("claude-cli with a model → still a ClaudeCliTextGenerator instance", () => {
    const llm = resolveLlm({ LLM_PROVIDER: "claude-cli", CLAUDE_CLI_MODEL: "claude-x" });
    expect(llm).toBeInstanceOf(ClaudeCliTextGenerator);
  });

  test("openrouter with both key and model → an OpenRouterTextGenerator instance", () => {
    const llm = resolveLlm({
      LLM_PROVIDER: "openrouter",
      OPENROUTER_API_KEY: "key",
      OPENROUTER_MODEL: "some/model",
    });
    expect(llm).toBeInstanceOf(OpenRouterTextGenerator);
  });

  test("openrouter missing the API key → null", () => {
    const llm = resolveLlm({ LLM_PROVIDER: "openrouter", OPENROUTER_MODEL: "some/model" });
    expect(llm).toBeNull();
  });

  test("openrouter missing the model → null", () => {
    const llm = resolveLlm({ LLM_PROVIDER: "openrouter", OPENROUTER_API_KEY: "key" });
    expect(llm).toBeNull();
  });

  test("unset provider → null", () => {
    expect(resolveLlm({})).toBeNull();
  });

  test("unknown provider → null", () => {
    expect(resolveLlm({ LLM_PROVIDER: "something-else" })).toBeNull();
  });
});
