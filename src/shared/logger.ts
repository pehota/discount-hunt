/**
 * Structured logger — token-cheap, greppable key=value lines.
 *
 * Format: `[LEVEL] event key1="string val" key2=123`
 *   - level is uppercased inside brackets
 *   - string field values are double-quoted
 *   - numbers (and other non-strings) are unquoted
 *   - keys are emitted in insertion order
 *   - no fields → just `[LEVEL] event` (no trailing space)
 *
 * ConsoleLogger routes info→console.log and warn/error→console.error.
 */

export type LogLevel = "info" | "warn" | "error";

export interface Logger {
  log(level: LogLevel, event: string, fields?: Record<string, unknown>): void;
}

/** Pure formatter — no I/O. Exported for direct unit testing. */
export function formatLine(
  level: LogLevel,
  event: string,
  fields?: Record<string, unknown>,
): string {
  const head = `[${level.toUpperCase()}] ${event}`;
  if (!fields) {
    return head;
  }
  const parts = Object.entries(fields).map(([key, value]) => `${key}=${formatValue(value)}`);
  if (parts.length === 0) {
    return head;
  }
  return `${head} ${parts.join(" ")}`;
}

function formatValue(value: unknown): string {
  if (typeof value === "string") {
    return `"${value}"`;
  }
  return String(value);
}

export class ConsoleLogger implements Logger {
  log(level: LogLevel, event: string, fields?: Record<string, unknown>): void {
    const line = formatLine(level, event, fields);
    if (level === "info") {
      console.log(line);
    } else {
      console.error(line);
    }
  }
}
