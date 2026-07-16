/**
 * VMarktCatalogueFetcher unit tests — PBT with fast-check + stub fetch.
 *
 * Properties tested:
 *   AC2/5 — slug discovery: given hrefs with mix of matching/non-matching slugs,
 *            fetcher selects the lexicographically latest \d{4}_VMMUC slug.
 *   AC2/3 — no Anthropic API called: FakeCatalogueExtractor used, fetchCurrentWeek works.
 *   AC2/4 — paragraph delegation: <p> text blocks are passed to extractProducts().
 *   AC1/2  — filter invariant: entries where salePrice >= regularPrice are excluded.
 *   AC6   — output shape: survivor items carry the CatalogueNormalizer-compatible shape.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import fc from "fast-check";
import { VMarktCatalogueFetcher } from "./v-markt-catalogue-fetcher.ts";
import { FakeCatalogueExtractor } from "../../../tests/acceptance/support/fake-catalogue-extractor.ts";
import type { LogLevel, Logger } from "../../shared/logger.ts";
import { currentWeekSunday } from "../../shared/week.ts";

// ── Spy logger for stage-event assertions ─────────────────────────────────────

interface CapturedEvent {
  level: LogLevel;
  event: string;
  fields: Record<string, unknown>;
}

class SpyLogger implements Logger {
  readonly events: CapturedEvent[] = [];
  log(level: LogLevel, event: string, fields?: Record<string, unknown>): void {
    this.events.push({ level, event, fields: fields ?? {} });
  }
  find(event: string): CapturedEvent | undefined {
    return this.events.find((e) => e.event === event);
  }
}

// ── Response helpers ──────────────────────────────────────────────────────────

function makeHtmlResponse(html: string): Response {
  return {
    ok: true,
    status: 200,
    text: async () => html,
    json: async () => { throw new Error("not JSON"); },
    headers: new Headers({ "content-type": "text/html" }),
  } as unknown as Response;
}

/**
 * Build slug-discovery HTML with the given hrefs embedded in anchor tags.
 */
function makeDiscoveryHtml(hrefs: string[]): string {
  const anchors = hrefs
    .map((href) => `<a href="${href}">link</a>`)
    .join("\n");
  return `<html><body>${anchors}</body></html>`;
}

/**
 * Build catalogue page HTML with the given paragraph strings.
 */
function makeCatalogueHtml(paragraphs: string[]): string {
  const pTags = paragraphs.map((p) => `<p>${p}</p>`).join("\n");
  return `<html><body>${pTags}</body></html>`;
}

// ── Save/restore globalThis.fetch ────────────────────────────────────────────

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

// ── AC5: slug selection (single-example, bypass justified) ────────────────────

describe("VMarktCatalogueFetcher — slug discovery", () => {
  test(
    // bypass: slug selection is a deterministic sort on a concrete format string,
    // not an invariant property — property testing adds no semantic coverage here.
    "Example: selects lexicographically latest VMMUC slug from mixed hrefs",
    async () => {
      const hrefs = [
        "https://www.pageflip.v-markt.de/muenchen/2312_VMMUC/",
        "https://www.pageflip.v-markt.de/muenchen/2408_VMMUC/",
        "https://www.pageflip.v-markt.de/muenchen/2401_VMMUC/",
        "https://www.pageflip.v-markt.de/muenchen/not-matching/",
        "https://other.example.com/muenchen/2501_VMMUC/",
      ];
      const discoveryHtml = makeDiscoveryHtml(hrefs);
      const catalogueHtml = makeCatalogueHtml(["Bio Haferflocken 500g 2.29€"]);
      const fixture = [
        { name: "Bio Haferflocken 500g", regularPrice: "2.29", salePrice: "1.49" },
      ];
      const extractor = new FakeCatalogueExtractor(fixture);

      globalThis.fetch = (async (url: Parameters<typeof fetch>[0]): Promise<Response> => {
        const urlStr = String(url);
        if (urlStr.includes("v-markt.de/angebote/muenchen")) {
          return makeHtmlResponse(discoveryHtml);
        }
        if (urlStr.includes("2408_VMMUC")) {
          return makeHtmlResponse(catalogueHtml);
        }
        throw new Error(`Unexpected URL: ${urlStr}`);
      }) as unknown as typeof fetch;

      const fetcher = new VMarktCatalogueFetcher(extractor);
      await fetcher.fetchCurrentWeek(); // must not throw — correct slug selected
      // If wrong slug selected, the fetch stub would throw — test passes implicitly.
      // Additional assertion: extractor received paragraphs from the catalogue page.
      expect(extractor.lastParagraphs).toEqual(["Bio Haferflocken 500g 2.29€"]);
    }
  );
});

// ── AC4: paragraph delegation ─────────────────────────────────────────────────

describe("VMarktCatalogueFetcher — paragraph delegation", () => {
  test("Passes extracted <p> text blocks to CatalogueExtractor.extractProducts()", async () => {
    const paragraphs = ["Zucchini 500g", "Tomaten 1kg frisch", "Äpfel 6er Pack"];
    const catalogueHtml = makeCatalogueHtml(paragraphs);
    const discoveryHtml = makeDiscoveryHtml([
      "https://www.pageflip.v-markt.de/muenchen/2408_VMMUC/",
    ]);
    const fixture = [
      { name: "Zucchini", regularPrice: "1.99", salePrice: "0.99" },
    ];
    const extractor = new FakeCatalogueExtractor(fixture);

    globalThis.fetch = (async (url: Parameters<typeof fetch>[0]): Promise<Response> => {
      const urlStr = String(url);
      if (urlStr.includes("v-markt.de/angebote/muenchen")) {
        return makeHtmlResponse(discoveryHtml);
      }
      return makeHtmlResponse(catalogueHtml);
    }) as unknown as typeof fetch;

    const fetcher = new VMarktCatalogueFetcher(extractor);
    await fetcher.fetchCurrentWeek();

    expect(extractor.lastParagraphs).toEqual(paragraphs);
  });
});

// ── AC2: price filter invariant (PBT) ────────────────────────────────────────

describe("VMarktCatalogueFetcher — price filter invariant", () => {
  test(
    "Property: entries where salePrice >= regularPrice are always excluded from output",
    async () => {
      await fc.assert(
        fc.asyncProperty(
          // Generate arrays of extracted products — some valid discounts, some not
          fc.array(
            fc.oneof(
              // Included: salePrice < regularPrice
              fc
                .tuple(
                  fc.integer({ min: 200, max: 9999 }),
                  fc.integer({ min: 1, max: 199 })
                )
                .map(([regular, sale]) => ({
                  name: "Product",
                  regularPrice: (regular / 100).toFixed(2),
                  salePrice: (sale / 100).toFixed(2),
                })),
              // Excluded: salePrice === regularPrice
              fc.integer({ min: 100, max: 9999 }).map((cents) => ({
                name: "Equal",
                regularPrice: (cents / 100).toFixed(2),
                salePrice: (cents / 100).toFixed(2),
              })),
              // Excluded: salePrice > regularPrice
              fc
                .tuple(
                  fc.integer({ min: 1, max: 9000 }),
                  fc.integer({ min: 100, max: 9999 })
                )
                .filter(([regular, sale]) => sale > regular)
                .map(([regular, sale]) => ({
                  name: "Overpriced",
                  regularPrice: (regular / 100).toFixed(2),
                  salePrice: (sale / 100).toFixed(2),
                }))
            ),
            { minLength: 1, maxLength: 20 }
          ),
          async (extractedItems) => {
            const discoveryHtml = makeDiscoveryHtml([
              "https://www.pageflip.v-markt.de/muenchen/2408_VMMUC/",
            ]);
            const catalogueHtml = makeCatalogueHtml(["dummy paragraph"]);
            const extractor = new FakeCatalogueExtractor(extractedItems);

            globalThis.fetch = (async (url: Parameters<typeof fetch>[0]): Promise<Response> => {
              const urlStr = String(url);
              if (urlStr.includes("v-markt.de/angebote/muenchen")) {
                return makeHtmlResponse(discoveryHtml);
              }
              return makeHtmlResponse(catalogueHtml);
            }) as unknown as typeof fetch;

            const fetcher = new VMarktCatalogueFetcher(extractor);
            const result = await fetcher.fetchCurrentWeek();

            // State-delta invariants:
            // 1. Every returned item has discountedPrice < price (mapped field names)
            const allValid = result.every((item) => {
              const r = item as { price: string; discountedPrice: string };
              return parseFloat(r.discountedPrice) < parseFloat(r.price);
            });

            // 2. Count: only items with salePrice < regularPrice survive
            const expectedCount = extractedItems.filter(
              (i) => parseFloat(i.salePrice) < parseFloat(i.regularPrice)
            ).length;

            // 3. O ⊆ S (every output title maps back to an input)
            const inputNames = new Set(extractedItems.map((i) => i.name));
            const allTitlesFromInput = result.every((item) => {
              const r = item as { title: string };
              return inputNames.has(r.title);
            });

            return allValid && result.length === expectedCount && allTitlesFromInput;
          }
        ),
        { numRuns: 50 }
      );
    }
  );
});

// ── AC6: output shape ─────────────────────────────────────────────────────────

describe("VMarktCatalogueFetcher — output shape", () => {
  test(
    "Survivor items carry the CatalogueNormalizer-compatible shape",
    async () => {
      const fixture = [
        { name: "Bio Haferflocken 500g", regularPrice: "2.29", salePrice: "1.49" },
        { name: "Rote Linsen 400g", regularPrice: "1.99", salePrice: "1.19" },
        { name: "EqualPrice", regularPrice: "1.00", salePrice: "1.00" }, // excluded
      ];
      const extractor = new FakeCatalogueExtractor(fixture);
      const discoveryHtml = makeDiscoveryHtml([
        "https://www.pageflip.v-markt.de/muenchen/2408_VMMUC/",
      ]);
      const catalogueHtml = makeCatalogueHtml(["some text"]);

      globalThis.fetch = (async (url: Parameters<typeof fetch>[0]): Promise<Response> => {
        const urlStr = String(url);
        if (urlStr.includes("v-markt.de/angebote/muenchen")) {
          return makeHtmlResponse(discoveryHtml);
        }
        return makeHtmlResponse(catalogueHtml);
      }) as unknown as typeof fetch;

      const fetcher = new VMarktCatalogueFetcher(extractor);
      const result = await fetcher.fetchCurrentWeek();

      // Only 2 survive (salePrice < regularPrice)
      expect(result).toHaveLength(2);

      // Each item must carry the full CatalogueNormalizer-compatible shape
      for (const item of result) {
        const r = item as unknown as Record<string, unknown>;
        expect(typeof r.id).toBe("string");
        expect(r.title).toBeDefined();
        expect(r.brand).toBe("V-Markt");
        expect(typeof r.price).toBe("string");
        expect(typeof r.discountedPrice).toBe("string");
        // validUntil is a full ISO date = end of the current week (SSOT: currentWeekSunday),
        // NOT a malformed "MM-DD" — otherwise the feed's string compare drops every item.
        expect(r.customLabel1).toBe(currentWeekSunday());
        expect(r.customLabel1).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(r.productType).toBe("grocery");
        expect(Array.isArray(r.photoUrls)).toBe(true);
      }
    }
  );

  test("Does not call the Anthropic API (FakeCatalogueExtractor is used)", async () => {
    // AC3: if we reach here without an API error, Anthropic was never called.
    const extractor = new FakeCatalogueExtractor();
    const discoveryHtml = makeDiscoveryHtml([
      "https://www.pageflip.v-markt.de/muenchen/2312_VMMUC/",
    ]);
    const catalogueHtml = makeCatalogueHtml(["text"]);

    globalThis.fetch = (async (url: Parameters<typeof fetch>[0]): Promise<Response> => {
      const urlStr = String(url);
      if (urlStr.includes("v-markt.de/angebote/muenchen")) {
        return makeHtmlResponse(discoveryHtml);
      }
      return makeHtmlResponse(catalogueHtml);
    }) as unknown as typeof fetch;

    const fetcher = new VMarktCatalogueFetcher(extractor);
    // Must not throw — no real API key needed, FakeCatalogueExtractor handles it.
    const result = await fetcher.fetchCurrentWeek();
    expect(Array.isArray(result)).toBe(true);
  });
});

// ── 10-02: stage logging + zero_kept drift warning ────────────────────────────

describe("VMarktCatalogueFetcher — stage logging", () => {
  // bypass: interaction test over a spy logger — verifies emitted stage events, not an invariant.

  test("emits slug, paragraphs, and extracted events with counts", async () => {
    const paragraphs = ["Zucchini 500g", "Tomaten 1kg"];
    const discoveryHtml = makeDiscoveryHtml([
      "https://www.pageflip.v-markt.de/muenchen/2408_VMMUC/",
    ]);
    const catalogueHtml = makeCatalogueHtml(paragraphs);
    const fixture = [
      { name: "Zucchini", regularPrice: "1.99", salePrice: "0.99" },
      { name: "Equal", regularPrice: "1.00", salePrice: "1.00" }, // excluded
    ];
    const extractor = new FakeCatalogueExtractor(fixture);

    globalThis.fetch = (async (url: Parameters<typeof fetch>[0]): Promise<Response> => {
      const urlStr = String(url);
      if (urlStr.includes("v-markt.de/angebote/muenchen")) return makeHtmlResponse(discoveryHtml);
      return makeHtmlResponse(catalogueHtml);
    }) as unknown as typeof fetch;

    const spy = new SpyLogger();
    const fetcher = new VMarktCatalogueFetcher(extractor, undefined, spy);
    await fetcher.fetchCurrentWeek();

    expect(spy.find("scrape.vmarkt.slug")!.fields.slug).toBe("2408_VMMUC");
    expect(spy.find("scrape.vmarkt.paragraphs")!.fields.count).toBe(2);
    expect(spy.find("scrape.vmarkt.extracted")!.fields).toMatchObject({ extracted: 2, kept: 1 });
  });

  test("emits zero_kept WARN when extracted entries exist but none survive the filter", async () => {
    const discoveryHtml = makeDiscoveryHtml([
      "https://www.pageflip.v-markt.de/muenchen/2408_VMMUC/",
    ]);
    const catalogueHtml = makeCatalogueHtml(["text"]);
    // extracted>0 but all salePrice >= regularPrice → kept===0.
    const fixture = [
      { name: "A", regularPrice: "1.00", salePrice: "1.00" },
      { name: "B", regularPrice: "1.00", salePrice: "2.00" },
    ];
    const extractor = new FakeCatalogueExtractor(fixture);

    globalThis.fetch = (async (url: Parameters<typeof fetch>[0]): Promise<Response> => {
      const urlStr = String(url);
      if (urlStr.includes("v-markt.de/angebote/muenchen")) return makeHtmlResponse(discoveryHtml);
      return makeHtmlResponse(catalogueHtml);
    }) as unknown as typeof fetch;

    const spy = new SpyLogger();
    const fetcher = new VMarktCatalogueFetcher(extractor, undefined, spy);
    const result = await fetcher.fetchCurrentWeek();

    expect(result).toHaveLength(0);
    const zeroKept = spy.find("scrape.vmarkt.zero_kept");
    expect(zeroKept).toBeDefined();
    expect(zeroKept!.level).toBe("warn");
    expect(zeroKept!.fields.extracted).toBe(2);
  });

  test("does NOT emit zero_kept when at least one item is kept", async () => {
    const discoveryHtml = makeDiscoveryHtml([
      "https://www.pageflip.v-markt.de/muenchen/2408_VMMUC/",
    ]);
    const catalogueHtml = makeCatalogueHtml(["text"]);
    const fixture = [{ name: "A", regularPrice: "2.00", salePrice: "1.00" }];
    const extractor = new FakeCatalogueExtractor(fixture);

    globalThis.fetch = (async (url: Parameters<typeof fetch>[0]): Promise<Response> => {
      const urlStr = String(url);
      if (urlStr.includes("v-markt.de/angebote/muenchen")) return makeHtmlResponse(discoveryHtml);
      return makeHtmlResponse(catalogueHtml);
    }) as unknown as typeof fetch;

    const spy = new SpyLogger();
    const fetcher = new VMarktCatalogueFetcher(extractor, undefined, spy);
    await fetcher.fetchCurrentWeek();

    expect(spy.find("scrape.vmarkt.zero_kept")).toBeUndefined();
  });
});
