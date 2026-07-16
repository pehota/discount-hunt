/**
 * Shared-kernel type-guard tests. The tag vocabulary is the SSOT (TAGS); these
 * tests reference it directly — never a copied literal list.
 */

import { describe, test, expect } from "bun:test";
import { TAGS, isTag } from "./types.ts";

describe("isTag", () => {
  test("returns true for every member of the TAGS SSOT", () => {
    for (const tag of TAGS) {
      expect(isTag(tag)).toBe(true);
    }
  });

  test.each(["Nonsense", "", "frozen", "FROZEN"])(
    "returns false for the non-member %o",
    (value) => {
      expect(isTag(value)).toBe(false);
    },
  );

  test("TAGS has no duplicates", () => {
    expect(new Set(TAGS).size).toBe(TAGS.length);
  });
});
