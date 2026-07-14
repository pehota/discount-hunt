/**
 * Unit tests for isCompatible — property-based using fast-check.
 *
 * Contract (pure predicate, no I/O):
 *   "none"         → always compatible regardless of tags
 *   "vegetarian"   → incompatible if contains-meat OR contains-fish is present
 *   "vegan"        → compatible only if "vegan" tag is present
 */

import { describe, test, expect } from "bun:test";
import fc from "fast-check";
import { isCompatible } from "./dietary.ts";
import type { DietaryTag, DietaryRestriction } from "./types.ts";

const ALL_TAGS: DietaryTag[] = ["vegan", "vegetarian", "contains-meat", "contains-fish", "unknown"];

// Arbitrary: any subset of ALL_TAGS
const tagSetArb = fc.shuffledSubarray(ALL_TAGS) as fc.Arbitrary<DietaryTag[]>;

describe("isCompatible", () => {
  test("none restriction is always compatible regardless of tags", () => {
    fc.assert(
      fc.property(tagSetArb, (tags) => {
        expect(isCompatible(tags, "none")).toBe(true);
      }),
      { numRuns: 100 }
    );
  });

  test("vegetarian restriction is incompatible when contains-meat is present", () => {
    fc.assert(
      fc.property(
        tagSetArb.filter((tags) => tags.includes("contains-meat")),
        (tags) => {
          expect(isCompatible(tags, "vegetarian")).toBe(false);
        }
      ),
      { numRuns: 50 }
    );
  });

  test("vegetarian restriction is incompatible when contains-fish is present", () => {
    fc.assert(
      fc.property(
        tagSetArb.filter((tags) => tags.includes("contains-fish")),
        (tags) => {
          expect(isCompatible(tags, "vegetarian")).toBe(false);
        }
      ),
      { numRuns: 50 }
    );
  });

  test("vegetarian restriction is compatible when neither contains-meat nor contains-fish is present", () => {
    fc.assert(
      fc.property(
        tagSetArb.filter(
          (tags) => !tags.includes("contains-meat") && !tags.includes("contains-fish")
        ),
        (tags) => {
          expect(isCompatible(tags, "vegetarian")).toBe(true);
        }
      ),
      { numRuns: 50 }
    );
  });

  test("vegan restriction is compatible only when vegan tag is present", () => {
    fc.assert(
      fc.property(
        tagSetArb.filter((tags) => tags.includes("vegan")),
        (tags) => {
          expect(isCompatible(tags, "vegan")).toBe(true);
        }
      ),
      { numRuns: 50 }
    );
  });

  test("vegan restriction is incompatible when vegan tag is absent", () => {
    fc.assert(
      fc.property(
        tagSetArb.filter((tags) => !tags.includes("vegan")),
        (tags) => {
          expect(isCompatible(tags, "vegan")).toBe(false);
        }
      ),
      { numRuns: 50 }
    );
  });
});
