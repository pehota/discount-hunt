/**
 * OpenRouterTextGenerator — OpenRouter adapter (prod provider).
 *
 * Wraps any Vercel AI SDK LanguageModel (constructed for OpenRouter's
 * OpenAI-compatible endpoint at wiring time; see ../resolve-llm.ts) behind the
 * LlmTextGenerator port: system + user prompt in, generated text out.
 */

import { generateText, type LanguageModel } from "ai";
import type { LlmTextGenerator } from "../ports/llm-text-generator.ts";

export class OpenRouterTextGenerator implements LlmTextGenerator {
  constructor(private readonly model: LanguageModel) {}

  async run(systemPrompt: string, userPrompt: string): Promise<string> {
    const { text } = await generateText({
      model: this.model,
      system: systemPrompt,
      prompt: userPrompt,
    });
    return text;
  }
}
