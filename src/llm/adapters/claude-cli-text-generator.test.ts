/**
 * ClaudeCliTextGenerator unit tests.
 *
 * Injects a FAKE runner (captures args, returns canned {stdout, exitCode}) so no
 * real `claude` subprocess is spawned. Verifies:
 *   - the EXACT args array with a model configured and with none,
 *   - `result` is returned on success (exit 0 + is_error:false),
 *   - a throw on is_error:true, on non-zero exit, and on unparseable stdout.
 *
 * bypass: adapter arg-building / parse tests are example-based (specific
 * input→output), not invariant-based.
 */

import { describe, test, expect } from "bun:test";
import { ClaudeCliTextGenerator } from "./claude-cli-text-generator.ts";

/** A fake runner that records the args it was called with and replays a result. */
function fakeRunner(result: { stdout: string; exitCode: number; stderr?: string }) {
  const calls: string[][] = [];
  const run = async (args: string[]) => {
    calls.push(args);
    return result;
  };
  return { calls, run };
}

const OK_STDOUT = JSON.stringify({ type: "result", is_error: false, result: "hello" });

describe("ClaudeCliTextGenerator", () => {
  test("builds the exact args array WITH a model configured", async () => {
    const runner = fakeRunner({ stdout: OK_STDOUT, exitCode: 0 });
    const gen = new ClaudeCliTextGenerator({ model: "claude-x", run: runner.run });

    await gen.run("SYS", "USER");

    expect(runner.calls).toHaveLength(1);
    expect(runner.calls[0]).toEqual([
      "-p",
      "USER",
      "--output-format",
      "json",
      "--system-prompt",
      "SYS",
      "--model",
      "claude-x",
    ]);
  });

  test("builds the exact args array WITHOUT a model (flag omitted)", async () => {
    const runner = fakeRunner({ stdout: OK_STDOUT, exitCode: 0 });
    const gen = new ClaudeCliTextGenerator({ run: runner.run });

    await gen.run("SYS", "USER");

    expect(runner.calls[0]).toEqual([
      "-p",
      "USER",
      "--output-format",
      "json",
      "--system-prompt",
      "SYS",
    ]);
  });

  test("returns the parsed `result` on success", async () => {
    const runner = fakeRunner({ stdout: OK_STDOUT, exitCode: 0 });
    const gen = new ClaudeCliTextGenerator({ run: runner.run });

    expect(await gen.run("SYS", "USER")).toBe("hello");
  });

  test("throws when is_error is true", async () => {
    const stdout = JSON.stringify({ type: "result", is_error: true, result: "boom" });
    const runner = fakeRunner({ stdout, exitCode: 0 });
    const gen = new ClaudeCliTextGenerator({ run: runner.run });

    await expect(gen.run("SYS", "USER")).rejects.toThrow(/boom/);
  });

  test("throws on a non-zero exit code", async () => {
    const runner = fakeRunner({ stdout: OK_STDOUT, exitCode: 1 });
    const gen = new ClaudeCliTextGenerator({ run: runner.run });

    await expect(gen.run("SYS", "USER")).rejects.toThrow();
  });

  test("throws when stdout is not valid JSON", async () => {
    const runner = fakeRunner({ stdout: "not json at all", exitCode: 0 });
    const gen = new ClaudeCliTextGenerator({ run: runner.run });

    await expect(gen.run("SYS", "USER")).rejects.toThrow();
  });

  test("surfaces exit code and stderr on a crash with empty stdout", async () => {
    const runner = fakeRunner({ stdout: "", exitCode: 127, stderr: "auth token expired" });
    const gen = new ClaudeCliTextGenerator({ run: runner.run });

    await expect(gen.run("SYS", "USER")).rejects.toThrow(/127.*auth token expired/s);
  });
});
