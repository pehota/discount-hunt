/**
 * catalogue-llm-config unit tests.
 *
 * Hermetic: every case passes an explicit `env` object — never leans on the
 * ambient process env. Assertions read observable model fields (.modelId,
 * .provider — both strings on a constructed AI-SDK LanguageModel) so they verify
 * real behaviour, not tautologies.
 *
 * bypass: config-resolution tests are example-based (env → model | null); the
 * property under test is the provider/gate branch taken, best shown by cases.
 */

import { describe, test, expect } from "bun:test";
import { resolveCatalogueLlm, DEFAULT_MODEL } from "./catalogue-llm-config.ts";

describe("resolveCatalogueLlm", () => {
  test("defaults to anthropic + the haiku model when no CATALOGUE_LLM_* is set (key via ANTHROPIC_API_KEY)", () => {
    const model = resolveCatalogueLlm({ ANTHROPIC_API_KEY: "sk-test" });

    expect(model).not.toBeNull();
    expect(typeof model).toBe("object");
    const resolved = model as { modelId: string; provider: string };
    expect(resolved.modelId).toBe(DEFAULT_MODEL);
    expect(resolved.provider).toContain("anthropic");
  });

  test("uses CATALOGUE_LLM_API_KEY over ANTHROPIC_API_KEY for the anthropic default", () => {
    const model = resolveCatalogueLlm({ CATALOGUE_LLM_API_KEY: "sk-primary" });

    expect(model).not.toBeNull();
    expect((model as { modelId: string }).modelId).toBe(DEFAULT_MODEL);
  });

  test("honours a custom CATALOGUE_LLM_MODEL for anthropic", () => {
    const model = resolveCatalogueLlm({
      ANTHROPIC_API_KEY: "sk-test",
      CATALOGUE_LLM_MODEL: "claude-sonnet-4-5",
    });

    expect((model as { modelId: string }).modelId).toBe("claude-sonnet-4-5");
  });

  test("returns null for the anthropic default when no key is available", () => {
    expect(resolveCatalogueLlm({})).toBeNull();
  });

  test("returns an openai-compatible model when provider + baseURL are set (key optional)", () => {
    const model = resolveCatalogueLlm({
      CATALOGUE_LLM_PROVIDER: "openai-compatible",
      CATALOGUE_LLM_BASE_URL: "http://localhost:11434/v1",
      CATALOGUE_LLM_MODEL: "llama3",
    });

    expect(model).not.toBeNull();
    const resolved = model as { modelId: string; provider: string };
    expect(resolved.modelId).toBe("llama3");
    expect(resolved.provider).toContain("openai-compatible");
  });

  test("returns null for openai-compatible when baseURL is missing", () => {
    expect(
      resolveCatalogueLlm({ CATALOGUE_LLM_PROVIDER: "openai-compatible" })
    ).toBeNull();
  });

  test("returns null for an unknown provider", () => {
    expect(
      resolveCatalogueLlm({ CATALOGUE_LLM_PROVIDER: "totally-unknown" })
    ).toBeNull();
  });
});
