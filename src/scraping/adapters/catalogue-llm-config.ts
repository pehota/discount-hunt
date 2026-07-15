/**
 * catalogue-llm-config — resolves the catalogue-extraction LanguageModel from env.
 *
 * Provider selection is config-driven so the LLM is decoupled from any single
 * vendor. Env vars (all optional; defaults preserve the historical Anthropic/Haiku
 * behaviour so existing setups need zero new configuration):
 *
 *   CATALOGUE_LLM_PROVIDER — "anthropic" (default) | "openai-compatible"
 *   CATALOGUE_LLM_MODEL    — model id (default: claude-haiku-4-5-20251001)
 *   CATALOGUE_LLM_BASE_URL — required for openai-compatible (e.g. local Ollama)
 *   CATALOGUE_LLM_API_KEY  — the key; for anthropic it falls back to ANTHROPIC_API_KEY
 *
 * Returns a constructed LanguageModel when a usable config is present, else null
 * (= "catalogue LLM not configured"):
 *   - anthropic:        a key must be available (CATALOGUE_LLM_API_KEY | ANTHROPIC_API_KEY)
 *   - openai-compatible: a baseURL must be present (key optional — e.g. local Ollama)
 */

import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel } from "ai";

export const DEFAULT_MODEL = "claude-haiku-4-5-20251001";
const OPENAI_COMPATIBLE_PROVIDER_NAME = "openai-compatible";

export function resolveCatalogueLlm(
  env: Record<string, string | undefined> = process.env
): LanguageModel | null {
  const provider = env.CATALOGUE_LLM_PROVIDER ?? "anthropic";
  const model = env.CATALOGUE_LLM_MODEL ?? DEFAULT_MODEL;

  switch (provider) {
    case "anthropic": {
      const apiKey = env.CATALOGUE_LLM_API_KEY ?? env.ANTHROPIC_API_KEY;
      if (!apiKey) {
        return null;
      }
      return createAnthropic({ apiKey })(model);
    }
    case "openai-compatible": {
      const baseURL = env.CATALOGUE_LLM_BASE_URL;
      if (!baseURL) {
        return null;
      }
      const apiKey = env.CATALOGUE_LLM_API_KEY;
      return createOpenAICompatible({
        name: OPENAI_COMPATIBLE_PROVIDER_NAME,
        baseURL,
        ...(apiKey ? { apiKey } : {}),
      })(model);
    }
    default:
      return null;
  }
}
