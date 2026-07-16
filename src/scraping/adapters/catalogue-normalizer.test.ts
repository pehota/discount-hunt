/**
 * CatalogueNormalizer unit tests — PBT with fast-check.
 *
 * Properties tested:
 *   1. Items missing discountedPrice are never in output (D21).
 *   2. Price string maps to correct integer cents.
 *   3. Dietary tags applied per productType classification.
 */

import { describe, test, expect } from "bun:test";
import fc from "fast-check";
import { CatalogueNormalizer } from "./catalogue-normalizer.ts";

const normalizer = new CatalogueNormalizer();

// ── helpers ──────────────────────────────────────────────────────────────────

/** Build a minimal raw item with both prices present. */
function rawItem(overrides: Partial<{
  id: string;
  title: string;
  brand: string;
  price: string;
  discountedPrice: string | undefined;
  customLabel1: string;
  productType: string | undefined;
  photoUrls: string[];
  imageUrl: string | null;
  description: string | null;
}> = {}) {
  return {
    id: "item-001",
    title: "Zucchini",
    brand: "Aldi",
    price: "1.99",
    discountedPrice: "0.99",
    customLabel1: "2026-07-14",
    productType: "vegetable",
    photoUrls: [] as string[],
    ...overrides,
  };
}

// ── Property 1: D21 — items without discountedPrice are dropped ───────────────

describe("CatalogueNormalizer", () => {
  test("Property: items missing discountedPrice are never in output (D21)", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            id: fc.string({ minLength: 1 }),
            title: fc.string({ minLength: 1 }),
            brand: fc.constantFrom("Aldi", "Brand"),
            // Generate cents as integers, then format as price string — avoid float drift
            price: fc.integer({ min: 100, max: 9999 }).map((c) => (c / 100).toFixed(2)),
            discountedPrice: fc.option(
              fc.integer({ min: 10, max: 99 }).map((c) => (c / 100).toFixed(2)),
              { nil: undefined }
            ),
            customLabel1: fc.constant("2026-07-14"),
            productType: fc.constantFrom("vegetable", "legume", "meat", "fish", "other"),
            photoUrls: fc.constant([] as string[]),
          }),
          { minLength: 0, maxLength: 20 }
        ),
        (items) => {
          const result = normalizer.normalize(items);
          // Every item in output must have come from an item with discountedPrice present
          const inputIdsWithBothPrices = new Set(
            items
              .filter((i) => i.discountedPrice !== undefined && i.discountedPrice !== "")
              .map((i) => i.id)
          );
          return result.every((r) => inputIdsWithBothPrices.has(r.externalId));
        }
      )
    );
  });

  // ── Property 2: price string → integer cents ──────────────────────────────

  test("Property: price string maps to correct integer cents", () => {
    fc.assert(
      fc.property(
        // Generate whole cents (0–9999) to avoid float imprecision in toFixed(2) round-trips
        fc.integer({ min: 1, max: 9999 }),
        fc.integer({ min: 1, max: 99 }),
        (regularCents, saleCents) => {
          // Ensure regular > sale as required
          const actualSaleCents = Math.min(saleCents, regularCents - 1);
          if (actualSaleCents < 1) return true; // skip trivial edge

          const priceStr = (regularCents / 100).toFixed(2);
          const discountedStr = (actualSaleCents / 100).toFixed(2);

          const result = normalizer.normalize([
            rawItem({ price: priceStr, discountedPrice: discountedStr }),
          ]);

          if (result.length !== 1) return false;
          return (
            result[0]!.regularPrice === regularCents &&
            result[0]!.salePrice === actualSaleCents
          );
        }
      )
    );
  });

  // ── Regression: Aldi products missing productType (11-02) ─────────────────

  test("defaults category to 'unknown' and emits [] tags when productType is missing", () => {
    // Real Aldi nested products sometimes have no productType. Before the fix,
    // category was set to `undefined`, which later dropped the SQL binding and
    // crashed the insert with a malformed-SQL DrizzleError.
    // bypass: single-example characterises the missing-field edge; the tag
    // classification is already property-covered above.
    const [result] = normalizer.normalize([rawItem({ productType: undefined })]);

    expect(result!.category).toBe("unknown");
    expect(result!.category).toBeString();
    expect(result!.dietaryTags).toEqual([]);
  });

  // ── sourceUrl mapping (Feature B) ─────────────────────────────────────────

  test("maps sourceUrl through when present on the raw item", () => {
    const url = "https://prospekt.aldi-sued.de/kw27-26-op-mp/";
    const [result] = normalizer.normalize([{ ...rawItem(), sourceUrl: url }]);
    expect(result!.sourceUrl).toBe(url);
  });

  test("defaults sourceUrl to null when absent on the raw item", () => {
    const [result] = normalizer.normalize([rawItem()]);
    expect(result!.sourceUrl).toBeNull();
  });

  // ── detail fields mapping (imageUrl / brand / description) ─────────────────

  test("maps imageUrl/brand/description through when present on the raw item", () => {
    const imageUrl = "https://prospekt.aldi-sued.de/img/1.jpg";
    const brand = "GutBio";
    const description = "Frische Bio-Zucchini";
    const [result] = normalizer.normalize([
      { ...rawItem(), imageUrl, brand, description },
    ]);
    expect(result!.imageUrl).toBe(imageUrl);
    expect(result!.brand).toBe(brand);
    expect(result!.description).toBe(description);
  });

  test("defaults imageUrl/brand/description to null when absent on the raw item", () => {
    // rawItem() always carries brand, so drop it explicitly to exercise the absent case
    // alongside imageUrl/description (which rawItem never sets).
    const { brand: _brand, ...withoutBrand } = rawItem();
    const [result] = normalizer.normalize([withoutBrand]);
    expect(result!.imageUrl).toBeNull();
    expect(result!.brand).toBeNull();
    expect(result!.description).toBeNull();
  });

  // ── Property 3: dietary tags per productType ──────────────────────────────

  test("Property: dietary tags applied correctly per productType", () => {
    const TAG_MAP: Record<string, string[]> = {
      vegetable: ["vegan", "vegetarian"],
      legume: ["vegan", "vegetarian"],
      meat: ["contains-meat"],
      fish: ["contains-fish"],
      other: [],
      unknown: [],
    };

    fc.assert(
      fc.property(
        fc.constantFrom("vegetable", "legume", "meat", "fish", "other", "unknown"),
        (productType) => {
          const result = normalizer.normalize([rawItem({ productType })]);
          if (result.length !== 1) return false;
          const expected = TAG_MAP[productType] ?? [];
          const actual = result[0]!.dietaryTags;
          return (
            actual.length === expected.length &&
            expected.every((t) => actual.includes(t as never))
          );
        }
      )
    );
  });
});
