/**
 * LlmTextGenerator — driven port for one-shot LLM text generation.
 *
 * A single text-in / text-out contract shared by every catalogue/categorisation
 * consumer. Provider selection happens at wiring time (see ../resolve-llm.ts):
 * one env switch, two adapters (local `claude` CLI for dev, OpenRouter for prod).
 */

export interface LlmTextGenerator {
  run(systemPrompt: string, userPrompt: string): Promise<string>;
}
