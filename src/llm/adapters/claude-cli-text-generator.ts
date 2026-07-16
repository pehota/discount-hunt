/**
 * ClaudeCliTextGenerator — local `claude` CLI adapter (dev provider).
 *
 * Shells out to the logged-in local CLI, so it needs no API key. The subprocess
 * is invoked as:
 *   claude -p "<USER>" --output-format json --system-prompt "<SYSTEM>" [--model <ID>]
 * stdout is a single JSON object; success = exit 0 AND is_error===false; the
 * assistant text is the `result` field.
 *
 * The runner is injectable so tests never spawn a real process; construction is
 * side-effect free (no spawn in the constructor).
 */

import type { LlmTextGenerator } from "../ports/llm-text-generator.ts";

/**
 * Result of running the CLI subprocess: captured stdout, its exit code, and
 * (optionally) stderr. `stderr` is optional so injectable fake runners may omit
 * it; the default runner always captures it for diagnostics on failure.
 */
type CliResult = { stdout: string; exitCode: number; stderr?: string };

/** Shape of the JSON object `claude --output-format json` writes to stdout. */
interface ClaudeCliJson {
  result: string;
  is_error: boolean;
  type: string;
}

async function defaultRun(args: string[]): Promise<CliResult> {
  const proc = Bun.spawn(["claude", ...args], { stdio: ["ignore", "pipe", "pipe"] });
  // Drain stdout AND stderr concurrently: the `claude` CLI is verbose on stderr,
  // and reading stdout to completion first would deadlock once the stderr pipe
  // buffer (~64KB) fills — claude blocks writing stderr, so stdout never ends.
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { stdout, exitCode, stderr };
}

export class ClaudeCliTextGenerator implements LlmTextGenerator {
  private readonly model?: string | undefined;
  private readonly run_: (args: string[]) => Promise<CliResult>;

  constructor(config: {
    model?: string | undefined;
    run?: (args: string[]) => Promise<CliResult>;
  }) {
    this.model = config.model;
    this.run_ = config.run ?? defaultRun;
  }

  async run(systemPrompt: string, userPrompt: string): Promise<string> {
    const args = [
      "-p",
      userPrompt,
      "--output-format",
      "json",
      "--system-prompt",
      systemPrompt,
    ];
    if (this.model) {
      args.push("--model", this.model);
    }

    const { stdout, exitCode, stderr } = await this.run_(args);

    // Check the exit code FIRST: the most common failure (process crash / auth
    // error) yields a non-zero exit with empty/non-JSON stdout, so parsing first
    // would hide the exit code and stderr behind an "unparseable stdout" error.
    if (exitCode !== 0) {
      throw new Error(
        `claude CLI exited non-zero (exitCode=${exitCode}): stderr=${stderr ?? ""} stdout=${stdout}`,
      );
    }

    let parsed: ClaudeCliJson;
    try {
      parsed = JSON.parse(stdout) as ClaudeCliJson;
    } catch {
      throw new Error(`claude CLI returned unparseable stdout: ${stdout}`);
    }

    if (parsed.is_error) {
      throw new Error(`claude CLI reported an error (is_error=true): ${parsed.result}`);
    }

    return parsed.result;
  }
}
