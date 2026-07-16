/**
 * AldiSudCatalogueFetcher unit tests — PBT with fast-check + stub fetch.
 *
 * REAL schema (SPIKE 2026-07-15): a hotspots_data.json entry with type:"product"
 * carries its data in a NESTED products:[] array. A genuine deal = nested
 * discountedPrice present AND parseFloat(discountedPrice) < parseFloat(price).
 *
 * Properties tested:
 *   AC2  — slug parsing: given Location header matching pattern, parseSlug extracts slug correctly
 *   AC1/2 — nested extraction + discount filter: only nested products with discountedPrice < price survive
 *   AC2  — ISO validUntil: kept items carry customLabel1 = ISO end-of-current-week (Monday+6)
 *   AC3  — de-overlapped pagination (1-2,3-4,5-6…) + dedupe by nested product id
 *   AC6  — network error: HEAD failure rejects fetchCurrentWeek with structured error
 *
 * Approach:
 *   - parseSlug is an exported pure function — PBT it directly.
 *   - HTTP interactions: stub globalThis.fetch; restore in afterEach.
 *   - Drive AldiSudCatalogueFetcher through fetchCurrentWeek() at the public port.
 */

import { describe, test, expect, afterEach } from "bun:test";
import fc from "fast-check";
import {
  AldiSudCatalogueFetcher,
  parseSlug,
} from "./aldi-sud-catalogue-fetcher.ts";
import { currentWeekMonday } from "../../shared/week.ts";
import type { LogLevel, Logger } from "../../shared/logger.ts";

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
  eventNames(): string[] {
    return this.events.map((e) => e.event);
  }
  find(event: string): CapturedEvent | undefined {
    return this.events.find((e) => e.event === event);
  }
}

// ── Expected ISO validUntil = end-of-current-week (Monday + 6 days), UTC ──────

function expectedValidUntil(): string {
  const monday = new Date(`${currentWeekMonday()}T00:00:00Z`);
  monday.setUTCDate(monday.getUTCDate() + 6);
  return monday.toISOString().slice(0, 10);
}

// ── helpers ──────────────────────────────────────────────────────────────────

interface NestedProductOverrides {
  id?: string;
  title?: string;
  price?: string;
  discountedPrice?: string | undefined;
  productType?: string;
  customLabel1?: string;
  photoUrls?: string[];
}

/** Build a NESTED product (the real shape carried inside entry.products[]). */
function nestedProduct(overrides: NestedProductOverrides = {}) {
  const base = {
    id: "item-001",
    title: "Zucchini",
    description: "Frische Zucchini",
    price: "2.99",
    discountedPrice: "1.49" as string | undefined,
    productType: "Gemüse - Zucchini",
    customLabel1: "13.7.",
    photoUrls: ["https://img/1.jpg"],
  };
  const merged = { ...base, ...overrides };
  // Allow explicitly dropping discountedPrice (catalogue listing, no deal).
  if ("discountedPrice" in overrides && overrides.discountedPrice === undefined) {
    delete (merged as { discountedPrice?: string }).discountedPrice;
  }
  return merged;
}

/** Build a hotspot ENTRY of type:"product" wrapping the given nested products. */
function productEntry(products: ReturnType<typeof nestedProduct>[]) {
  return {
    type: "product",
    id: "entry-{first_product_title}",
    title: "{first_product_title}",
    products,
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

// ── AC2: slug parsing property (unchanged — parseSlug is untouched) ───────────

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

// ── AC1: nested extraction + discount filter + ISO validUntil ─────────────────

describe("AldiSudCatalogueFetcher — nested extraction + discount filter", () => {
  test("returns only the discounted nested product with ISO end-of-week validUntil", async () => {
    const slug = "kw27-26-op-mp";
    // One entry with two nested products: one discounted, one catalogue-only (no deal).
    const entry = productEntry([
      nestedProduct({ id: "deal-1", price: "0.65", discountedPrice: "0.59", title: "Tomaten" }),
      nestedProduct({ id: "listing-1", price: "1.19", discountedPrice: undefined, title: "Gurke" }),
    ]);

    globalThis.fetch = (async (url: Parameters<typeof fetch>[0], opts?: RequestInit): Promise<Response> => {
      if (opts?.method === "HEAD") {
        return makeRedirect(`//prospekt.aldi-sued.de/${slug}/`);
      }
      const urlStr = String(url);
      if (urlStr.includes("/page/1-2/")) return makeResponse(200, [entry]);
      return makeResponse(404, null);
    }) as unknown as typeof fetch;

    const fetcher = new AldiSudCatalogueFetcher();
    const result = await fetcher.fetchCurrentWeek();

    // Only the discounted nested product survives.
    expect(result).toHaveLength(1);
    const item = result[0] as {
      id: string;
      title: string;
      brand: string;
      price: string;
      discountedPrice?: string;
      customLabel1: string;
      productType: string;
      photoUrls: string[];
      sourceUrl: string;
    };
    expect(item.id).toBe("deal-1");
    expect(item.title).toBe("Tomaten");
    expect(item.brand).toBe("Aldi Süd");
    expect(item.price).toBe("0.65");
    expect(item.discountedPrice).toBe("0.59");
    // sourceUrl deep-links to the current-week catalogue slug (reuses ALDI_SUD_ORIGIN).
    expect(item.sourceUrl).toBe(`https://prospekt.aldi-sued.de/${slug}/`);
    expect(item.sourceUrl.startsWith("https://prospekt.aldi-sued.de/")).toBe(true);
    // ISO validUntil (end-of-week), NOT the raw German "d.m." start date.
    expect(item.customLabel1).toBe(expectedValidUntil());
    expect(item.customLabel1).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(item.photoUrls).toEqual([]);
  });

  test("Property: only nested products with discountedPrice < price survive, all carrying ISO validUntil", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.oneof(
            // Included: discountedPrice < price
            fc.tuple(
              fc.integer({ min: 200, max: 9999 }),
              fc.integer({ min: 1, max: 199 })
            ).map(([p, dp]) => nestedProduct({
              price: (p / 100).toFixed(2),
              discountedPrice: (dp / 100).toFixed(2),
            })),
            // Excluded: no discountedPrice (catalogue listing)
            fc.constant(nestedProduct({ discountedPrice: undefined })),
            // Excluded: discountedPrice >= price
            fc.integer({ min: 100, max: 9999 }).map((cents) =>
              nestedProduct({
                price: (cents / 100).toFixed(2),
                discountedPrice: (cents / 100).toFixed(2), // equal — excluded
              })
            )
          ),
          { minLength: 1, maxLength: 20 }
        ),
        async (products) => {
          // Assign unique ids so dedupe does not collapse distinct products.
          const withIds = products.map((p, i) => ({ ...p, id: `p-${i}` }));
          const slug = "kw27-26-op-mp";
          globalThis.fetch = (async (url: Parameters<typeof fetch>[0], opts?: RequestInit): Promise<Response> => {
            if (opts?.method === "HEAD") {
              return makeRedirect(`//prospekt.aldi-sued.de/${slug}/`);
            }
            const urlStr = String(url);
            if (urlStr.includes("/page/1-2/")) return makeResponse(200, [productEntry(withIds)]);
            return makeResponse(404, null);
          }) as unknown as typeof fetch;

          const fetcher = new AldiSudCatalogueFetcher();
          const result = await fetcher.fetchCurrentWeek();

          const iso = expectedValidUntil();
          const allValid = result.every((raw: unknown) => {
            const h = raw as { discountedPrice?: string; price: string; customLabel1: string };
            return (
              h.discountedPrice !== undefined &&
              h.discountedPrice !== "" &&
              parseFloat(h.discountedPrice) < parseFloat(h.price) &&
              h.customLabel1 === iso
            );
          });

          const expectedCount = withIds.filter(
            (i) =>
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

// ── AC3: de-overlapped pagination + dedupe ────────────────────────────────────

describe("AldiSudCatalogueFetcher — pagination", () => {
  test("fetches non-overlapping page ranges (1-2, 3-4, …) and stops after first 404", async () => {
    const slug = "kw27-26-op-mp";
    const page1 = [productEntry([nestedProduct({ id: "p1", price: "2.00", discountedPrice: "1.00" })])];
    const page2 = [productEntry([nestedProduct({ id: "p3", price: "2.00", discountedPrice: "1.00" })])];

    const pageRequests: string[] = [];
    globalThis.fetch = (async (url: Parameters<typeof fetch>[0], opts?: RequestInit): Promise<Response> => {
      if (opts?.method === "HEAD") {
        return makeRedirect(`//prospekt.aldi-sued.de/${slug}/`);
      }
      const urlStr = String(url);
      pageRequests.push(urlStr);
      if (urlStr.includes("/page/1-2/")) return makeResponse(200, page1);
      if (urlStr.includes("/page/3-4/")) return makeResponse(200, page2);
      return makeResponse(404, null);
    }) as unknown as typeof fetch;

    const fetcher = new AldiSudCatalogueFetcher();
    const result = await fetcher.fetchCurrentWeek();

    const ids = result.map((i: unknown) => (i as { id: string }).id);
    expect(ids).toContain("p1");
    expect(ids).toContain("p3");

    // De-overlapped stepping: 1-2 then 3-4 then 5-6 (404, stop). NO overlap (no 2-3).
    expect(pageRequests.some((u) => u.includes("/page/1-2/"))).toBe(true);
    expect(pageRequests.some((u) => u.includes("/page/3-4/"))).toBe(true);
    expect(pageRequests.some((u) => u.includes("/page/5-6/"))).toBe(true);
    expect(pageRequests.some((u) => u.includes("/page/2-3/"))).toBe(false);
    expect(pageRequests.some((u) => u.includes("/page/4-5/"))).toBe(false);
    expect(pageRequests.some((u) => u.includes("/page/7-8/"))).toBe(false);
  });

  test("dedupes nested products by id across pages", async () => {
    const slug = "kw27-26-op-mp";
    // Same product id "dup" appears on two different pages.
    const dup = nestedProduct({ id: "dup", price: "2.00", discountedPrice: "1.00" });
    const unique = nestedProduct({ id: "unique", price: "3.00", discountedPrice: "1.50" });

    globalThis.fetch = (async (url: Parameters<typeof fetch>[0], opts?: RequestInit): Promise<Response> => {
      if (opts?.method === "HEAD") {
        return makeRedirect(`//prospekt.aldi-sued.de/${slug}/`);
      }
      const urlStr = String(url);
      if (urlStr.includes("/page/1-2/")) return makeResponse(200, [productEntry([dup, unique])]);
      if (urlStr.includes("/page/3-4/")) return makeResponse(200, [productEntry([dup])]);
      return makeResponse(404, null);
    }) as unknown as typeof fetch;

    const fetcher = new AldiSudCatalogueFetcher();
    const result = await fetcher.fetchCurrentWeek();

    const ids = result.map((i: unknown) => (i as { id: string }).id).sort();
    expect(ids).toEqual(["dup", "unique"]);
  });

  test("Returns empty array when page 1 immediately returns 404", async () => {
    globalThis.fetch = (async (_url: Parameters<typeof fetch>[0], opts?: RequestInit): Promise<Response> => {
      if (opts?.method === "HEAD") {
        return makeRedirect("//prospekt.aldi-sued.de/kw27-26-op-mp/");
      }
      return makeResponse(404, null);
    }) as unknown as typeof fetch;

    const fetcher = new AldiSudCatalogueFetcher();
    const result = await fetcher.fetchCurrentWeek();
    expect(result).toEqual([]);
  });
});

// ── 10-02: stage logging + zero_kept drift warning ────────────────────────────

describe("AldiSudCatalogueFetcher — stage logging", () => {
  // bypass: interaction test over a spy logger — verifies emitted stage events, not an invariant.

  test("emits slug, per-page, and fetched events with counts", async () => {
    const slug = "kw27-26-op-mp";
    // One entry, two nested products, both discounted → rawTotal=2, kept=2.
    const page1 = [productEntry([
      nestedProduct({ id: "p1", price: "2.00", discountedPrice: "1.00" }),
      nestedProduct({ id: "p2", price: "2.00", discountedPrice: "1.00" }),
    ])];
    globalThis.fetch = (async (url: Parameters<typeof fetch>[0], opts?: RequestInit): Promise<Response> => {
      if (opts?.method === "HEAD") {
        return makeRedirect(`//prospekt.aldi-sued.de/${slug}/`);
      }
      const urlStr = String(url);
      if (urlStr.includes("/page/1-2/")) return makeResponse(200, page1);
      return makeResponse(404, null);
    }) as unknown as typeof fetch;

    const spy = new SpyLogger();
    const fetcher = new AldiSudCatalogueFetcher(spy);
    await fetcher.fetchCurrentWeek();

    expect(spy.find("scrape.aldi.slug")!.fields.slug).toBe(slug);
    const page = spy.find("scrape.aldi.page")!;
    // count = nested products flattened this page (2 nested products in the single entry).
    expect(page.fields).toMatchObject({ page: 1, count: 2 });
    const fetched = spy.find("scrape.aldi.fetched")!;
    expect(fetched.fields).toMatchObject({ rawTotal: 2, kept: 2 });
  });

  test("emits zero_kept WARN when raw products exist but none survive the filter", async () => {
    const slug = "kw27-26-op-mp";
    // 3 nested products, all catalogue-only (no discountedPrice) → rawTotal>0, kept===0.
    const page1 = [productEntry([
      nestedProduct({ id: "a", discountedPrice: undefined }),
      nestedProduct({ id: "b", discountedPrice: undefined }),
      nestedProduct({ id: "c", discountedPrice: undefined }),
    ])];
    globalThis.fetch = (async (url: Parameters<typeof fetch>[0], opts?: RequestInit): Promise<Response> => {
      if (opts?.method === "HEAD") {
        return makeRedirect(`//prospekt.aldi-sued.de/${slug}/`);
      }
      const urlStr = String(url);
      if (urlStr.includes("/page/1-2/")) return makeResponse(200, page1);
      return makeResponse(404, null);
    }) as unknown as typeof fetch;

    const spy = new SpyLogger();
    const fetcher = new AldiSudCatalogueFetcher(spy);
    const result = await fetcher.fetchCurrentWeek();

    expect(result).toHaveLength(0);
    const zeroKept = spy.find("scrape.aldi.zero_kept");
    expect(zeroKept).toBeDefined();
    expect(zeroKept!.level).toBe("warn");
    expect(zeroKept!.fields.rawTotal).toBe(3);
    expect(String(zeroKept!.fields.hint)).toContain("schema drift");
  });

  test("does NOT emit zero_kept when at least one product is kept", async () => {
    const slug = "kw27-26-op-mp";
    const page1 = [productEntry([
      nestedProduct({ id: "p1", price: "2.00", discountedPrice: "1.00" }),
      nestedProduct({ id: "p2", discountedPrice: undefined }),
    ])];
    globalThis.fetch = (async (url: Parameters<typeof fetch>[0], opts?: RequestInit): Promise<Response> => {
      if (opts?.method === "HEAD") {
        return makeRedirect(`//prospekt.aldi-sued.de/${slug}/`);
      }
      const urlStr = String(url);
      if (urlStr.includes("/page/1-2/")) return makeResponse(200, page1);
      return makeResponse(404, null);
    }) as unknown as typeof fetch;

    const spy = new SpyLogger();
    const fetcher = new AldiSudCatalogueFetcher(spy);
    await fetcher.fetchCurrentWeek();

    expect(spy.find("scrape.aldi.zero_kept")).toBeUndefined();
  });
});

// ── AC6: HEAD network error rejects (unchanged) ───────────────────────────────

describe("AldiSudCatalogueFetcher — network error", () => {
  test("Rejects with structured error when HEAD request throws", async () => {
    globalThis.fetch = (async (_url: Parameters<typeof fetch>[0], opts?: RequestInit): Promise<Response> => {
      if (opts?.method === "HEAD") {
        throw new Error("network error");
      }
      return makeResponse(200, []);
    }) as unknown as typeof fetch;

    const fetcher = new AldiSudCatalogueFetcher();
    await expect(fetcher.fetchCurrentWeek()).rejects.toThrow();
  });
});
