/**
 * AldiSudCatalogueFetcher unit tests — PBT with fast-check + stub fetch.
 *
 * Properties tested:
 *   AC2  — slug parsing: given Location header matching pattern, parseSlug extracts slug correctly
 *   AC1/4/5 — filter invariant: only product entries with discountedPrice < price survive
 *   AC3  — pagination stop: fetcher stops after first 404 page and flattens preceding results
 *   AC6  — network error: HEAD failure rejects fetchCurrentWeek with structured error
 *
 * Approach:
 *   - parseSlug is an exported pure function — PBT it directly.
 *   - HTTP interactions: stub globalThis.fetch in beforeEach; restore in afterEach.
 *   - Drive AldiSudCatalogueFetcher through fetchCurrentWeek() at the public port.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import fc from "fast-check";
import {
  AldiSudCatalogueFetcher,
  parseSlug,
} from "./aldi-sud-catalogue-fetcher.ts";

// ── helpers ──────────────────────────────────────────────────────────────────

/** Build a raw hotspot entry (product type with genuine discount). */
function hotspotProduct(overrides: Partial<{
  type: string;
  id: string;
  title: string;
  brand: string;
  price: string;
  discountedPrice: string | undefined;
  customLabel1: string;
  productType: string;
  photoUrls: string[];
}> = {}) {
  return {
    type: "product",
    id: "item-001",
    title: "Zucchini",
    brand: "Aldi",
    price: "2.99",
    discountedPrice: "1.49",
    customLabel1: "2026-07-14",
    productType: "vegetable",
    photoUrls: [] as string[],
    ...overrides,
  };
}

/** A Response stub with given status and JSON body. */
function makeResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(),
    json: async () => body,
  } as unknown as Response;
}

/** A redirect stub (302) with Location header. */
function makeRedirect(location: string): Response {
  return {
    ok: false,
    status: 302,
    headers: new Headers({ Location: location }),
    json: async () => { throw new Error("no body"); },
  } as unknown as Response;
}

// ── Save/restore globalThis.fetch ────────────────────────────────────────────

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

// ── AC2: slug parsing property ────────────────────────────────────────────────

describe("parseSlug", () => {
  test("Property: extracts slug from any valid Location header with no slashes in slug", () => {
    fc.assert(
      fc.property(
        // Slug segment: one or more chars, no forward slashes
        fc.stringMatching(/^[^/]+$/).filter((s) => s.length >= 1),
        (slug) => {
          const location = `//prospekt.aldi-sued.de/${slug}/`;
          const result = parseSlug(location);
          return result === slug;
        }
      ),
      { numRuns: 200 }
    );
  });

  test("Example: kw27-26-op-mp is extracted correctly (AC2 concrete example)", () => {
    const location = "//prospekt.aldi-sued.de/kw27-26-op-mp/";
    // bypass: single-example to validate the AC2 concrete fixture directly
    expect(parseSlug(location)).toBe("kw27-26-op-mp");
  });

  test("Throws structured error when Location header is absent", () => {
    expect(() => parseSlug(null)).toThrow();
  });

  test("Throws structured error when Location does not match pattern", () => {
    expect(() => parseSlug("//other-domain.com/kw27/")).toThrow();
  });
});

// ── AC1/4/5: filter invariant ─────────────────────────────────────────────────

describe("AldiSudCatalogueFetcher — filter invariant", () => {
  test("Property: only product entries where discountedPrice < price survive", async () => {
    await fc.assert(
      fc.asyncProperty(
        // Generate a mix of items
        fc.array(
          fc.oneof(
            // Included: product, discountedPrice < price
            fc.tuple(
              fc.integer({ min: 200, max: 9999 }),
              fc.integer({ min: 1, max: 199 })
            ).map(([p, dp]) => hotspotProduct({
              type: "product",
              price: (p / 100).toFixed(2),
              discountedPrice: (dp / 100).toFixed(2),
            })),
            // Excluded: banner
            fc.constant(hotspotProduct({ type: "banner" })),
            // Excluded: product but discountedPrice absent
            fc.constant(hotspotProduct({ type: "product", discountedPrice: undefined })),
            // Excluded: product but discountedPrice >= price
            fc.integer({ min: 100, max: 9999 }).map((cents) =>
              hotspotProduct({
                type: "product",
                price: (cents / 100).toFixed(2),
                discountedPrice: (cents / 100).toFixed(2), // equal — excluded
              })
            )
          ),
          { minLength: 1, maxLength: 20 }
        ),
        async (items) => {
          // Setup: stub fetch — HEAD returns slug, page 1 returns items, page 2 returns 404
          const slug = "kw27-26-op-mp";
          let callCount = 0;
          globalThis.fetch = async (url: RequestInfo | URL, opts?: RequestInit): Promise<Response> => {
            const urlStr = String(url);
            if (opts?.method === "HEAD") {
              return makeRedirect(`//prospekt.aldi-sued.de/${slug}/`);
            }
            callCount++;
            if (callCount === 1) {
              return makeResponse(200, items);
            }
            return makeResponse(404, null);
          };

          const fetcher = new AldiSudCatalogueFetcher();
          const result = await fetcher.fetchCurrentWeek();

          // All returned items must be: type=product AND have discountedPrice AND dp < p
          const allValid = result.every((item: unknown) => {
            const h = item as typeof items[0];
            return (
              h.type === "product" &&
              h.discountedPrice !== undefined &&
              h.discountedPrice !== "" &&
              parseFloat(h.discountedPrice) < parseFloat(h.price)
            );
          });

          // Count of expected-to-survive items: type=product AND dp present AND dp < p
          const expectedCount = items.filter(
            (i) =>
              i.type === "product" &&
              i.discountedPrice !== undefined &&
              (i.discountedPrice as string) !== "" &&
              parseFloat(i.discountedPrice as string) < parseFloat(i.price)
          ).length;

          return allValid && result.length === expectedCount;
        }
      ),
      { numRuns: 50 }
    );
  });
});

// ── AC3: pagination stop on 404 ───────────────────────────────────────────────

describe("AldiSudCatalogueFetcher — pagination", () => {
  test("Stops after first 404 and returns flattened items from preceding pages", async () => {
    const slug = "kw27-26-op-mp";
    const page1Items = [hotspotProduct({ id: "p1" }), hotspotProduct({ id: "p2" })];
    const page2Items = [hotspotProduct({ id: "p3" })];

    let pageRequests: string[] = [];
    globalThis.fetch = async (url: RequestInfo | URL, opts?: RequestInit): Promise<Response> => {
      const urlStr = String(url);
      if (opts?.method === "HEAD") {
        return makeRedirect(`//prospekt.aldi-sued.de/${slug}/`);
      }
      pageRequests.push(urlStr);
      if (urlStr.includes("/page/1-2/")) return makeResponse(200, page1Items);
      if (urlStr.includes("/page/2-3/")) return makeResponse(200, page2Items);
      return makeResponse(404, null);
    };

    const fetcher = new AldiSudCatalogueFetcher();
    const result = await fetcher.fetchCurrentWeek();

    // Should have items from pages 1 and 2 (page 3 → 404, stop)
    const ids = result.map((i: unknown) => (i as { id: string }).id);
    expect(ids).toContain("p1");
    expect(ids).toContain("p2");
    expect(ids).toContain("p3");
    // Page 3 was requested (returned 404, causing stop) but page 4 was not
    expect(pageRequests.some((u) => u.includes("/page/3-4/"))).toBe(true);
    expect(pageRequests.some((u) => u.includes("/page/4-5/"))).toBe(false);
  });

  test("Returns empty array when page 1 immediately returns 404", async () => {
    globalThis.fetch = async (_url: RequestInfo | URL, opts?: RequestInit): Promise<Response> => {
      if (opts?.method === "HEAD") {
        return makeRedirect("//prospekt.aldi-sued.de/kw27-26-op-mp/");
      }
      return makeResponse(404, null);
    };

    const fetcher = new AldiSudCatalogueFetcher();
    const result = await fetcher.fetchCurrentWeek();
    expect(result).toEqual([]);
  });
});

// ── AC6: HEAD network error rejects ──────────────────────────────────────────

describe("AldiSudCatalogueFetcher — network error", () => {
  test("Rejects with structured error when HEAD request throws", async () => {
    globalThis.fetch = async (_url: RequestInfo | URL, opts?: RequestInit): Promise<Response> => {
      if (opts?.method === "HEAD") {
        throw new Error("network error");
      }
      return makeResponse(200, []);
    };

    const fetcher = new AldiSudCatalogueFetcher();
    await expect(fetcher.fetchCurrentWeek()).rejects.toThrow();
  });
});
