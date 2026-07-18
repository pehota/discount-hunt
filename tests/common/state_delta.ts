/**
 * state_delta — minimal Universe-bound state-delta assertion (Mandate 8), TypeScript port.
 *
 * The canonical Python port (`nwave_ai/state_delta`) is illustrative; this is the discount-hunt
 * TS bootstrap (first DISTILL to need it — meal-plan-engine S01a keystone). It is deliberately
 * minimal: only the two predicates the meal-plan-engine acceptance suite actually uses are
 * implemented (`setTo`, `unchanged`). Extend by accretion as later features need more.
 *
 * Contract (identical across languages): `assertStateDelta(before, after, universe, expected)`.
 *   - `universe` = the SET of port-exposed observable names the test promises to track.
 *     Names MUST be port-exposed (rendered outputs, public read-model fields, row counts) —
 *     never internal struct fields.
 *   - `expected` maps each declared universe key to a predicate.
 *   - Anything in `universe` NOT in `expected` MUST remain unchanged (fail-closed).
 *
 * Used at layers 1-3. HTTP walking-skeleton / real-I/O tests (layer 4+) may use traditional
 * assertions instead (Mandate 8).
 */

export type Snapshot = Record<string, unknown>;

export interface Predicate {
  readonly kind: string;
  check(beforeVal: unknown, afterVal: unknown): { ok: boolean; message: string };
}

/** The observable changed to exactly `value`. */
export function setTo(value: unknown): Predicate {
  return {
    kind: "setTo",
    check(_before, after) {
      const ok = JSON.stringify(after) === JSON.stringify(value);
      return {
        ok,
        message: ok
          ? ""
          : `expected set_to(${JSON.stringify(value)}) but was ${JSON.stringify(after)}`,
      };
    },
  };
}

/** The observable is byte-identical before and after. */
export function unchanged(): Predicate {
  return {
    kind: "unchanged",
    check(before, after) {
      const ok = JSON.stringify(before) === JSON.stringify(after);
      return {
        ok,
        message: ok
          ? ""
          : `expected unchanged but ${JSON.stringify(before)} -> ${JSON.stringify(after)}`,
      };
    },
  };
}

/**
 * Assert the observable delta between two snapshots against a declared universe.
 * Fail-closed: any universe key that changed without an `expected` predicate is a violation.
 */
export function assertStateDelta(
  before: Snapshot,
  after: Snapshot,
  universe: readonly string[],
  expected: Record<string, Predicate>,
): void {
  const failures: string[] = [];

  for (const key of universe) {
    if (!(key in before) || !(key in after)) {
      failures.push(`universe key "${key}" absent from a snapshot (before/after)`);
      continue;
    }
    const pred = expected[key] ?? unchanged(); // fail-closed default
    const { ok, message } = pred.check(before[key], after[key]);
    if (!ok) failures.push(`${key}: ${message}`);
  }

  for (const key of Object.keys(expected)) {
    if (!universe.includes(key)) {
      failures.push(`expected key "${key}" is not declared in the universe`);
    }
  }

  if (failures.length > 0) {
    throw new Error(`assertStateDelta violations:\n  - ${failures.join("\n  - ")}`);
  }
}
