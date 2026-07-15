/**
 * Structured logger unit tests — formatLine (pure) + ConsoleLogger routing.
 *
 * formatLine contract:
 *   - level uppercased inside [BRACKETS]
 *   - string values double-quoted; numbers unquoted; insertion-order keys
 *   - empty / no fields → `[LEVEL] event` with no trailing space
 *   - ConsoleLogger: info→console.log, warn/error→console.error
 */

import { describe, test, expect } from "bun:test";
import fc from "fast-check";
import { formatLine, ConsoleLogger } from "./logger.ts";

describe("formatLine — levels", () => {
  test("uppercases each level inside brackets", () => {
    expect(formatLine("info", "e")).toBe("[INFO] e");
    expect(formatLine("warn", "e")).toBe("[WARN] e");
    expect(formatLine("error", "e")).toBe("[ERROR] e");
  });
});

describe("formatLine — no / empty fields", () => {
  test("no fields → head only, no trailing space", () => {
    const line = formatLine("info", "scrape.store.start");
    expect(line).toBe("[INFO] scrape.store.start");
    expect(line.endsWith(" ")).toBe(false);
  });

  test("empty fields object → head only, no trailing space", () => {
    const line = formatLine("info", "scrape.store.start", {});
    expect(line).toBe("[INFO] scrape.store.start");
    expect(line.endsWith(" ")).toBe(false);
  });
});

describe("formatLine — value formatting", () => {
  test("string values are double-quoted, numbers unquoted, keys in insertion order", () => {
    const line = formatLine("info", "scrape.store.start", {
      store: "Aldi Süd",
      rawCount: 99,
    });
    expect(line).toBe('[INFO] scrape.store.start store="Aldi Süd" rawCount=99');
  });

  test("Property: string values always quoted, numeric values never quoted", () => {
    fc.assert(
      fc.property(
        fc.string().filter((s) => !s.includes('"')),
        fc.integer(),
        (str, num) => {
          const line = formatLine("warn", "ev", { s: str, n: num });
          return line === `[WARN] ev s="${str}" n=${num}`;
        },
      ),
      { numRuns: 200 },
    );
  });
});

describe("ConsoleLogger — routing", () => {
  test("info→console.log, warn/error→console.error", () => {
    const logCalls: string[] = [];
    const errorCalls: string[] = [];
    const originalLog = console.log;
    const originalError = console.error;
    console.log = (...args: unknown[]) => { logCalls.push(String(args[0])); };
    console.error = (...args: unknown[]) => { errorCalls.push(String(args[0])); };
    try {
      const logger = new ConsoleLogger();
      logger.log("info", "i.event", { a: 1 });
      logger.log("warn", "w.event", { b: 2 });
      logger.log("error", "e.event");
    } finally {
      console.log = originalLog;
      console.error = originalError;
    }
    expect(logCalls).toEqual(['[INFO] i.event a=1']);
    expect(errorCalls).toEqual(['[WARN] w.event b=2', '[ERROR] e.event']);
  });
});
