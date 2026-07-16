/**
 * MarktguruEdekaCatalogueFetcher unit tests — injected fake fetch + recorded requests.
 *
 * Behaviours tested:
 *   1. Bootstrap keys: apiKey/clientKey scraped from the homepage HTML are sent as
 *      x-apikey / x-clientkey headers on every SEARCH call.
 *   2. Advertiser filter: only edeka is kept; edeka-center (hypermarket) and
 *      edeka-xpress (convenience) are dropped as distinct store FORMATS, as are
 *      non-Edeka advertisers (e.g. "lidl").
 *   3a. Dedupe by offer.id: the same offer.id returned by two search terms yields
 *       exactly one item.
 *   3b. Secondary dedupe by (product.id, price): distinct offer ids sharing a
 *       product.id + price collapse to one; different price keeps both; the offer
 *       carrying an oldPrice wins the tie; missing product.id falls back to name.
 *   4. Mapping (incl. equal-price survival): regular==oldPrice when oldPrice present;
 *      regular==sale (and item PRESENT) when oldPrice is null; validUntil is a full
 *      YYYY-MM-DD from the latest validityDates.to; productType from category name;
 *      title = "brand product".
 *   5. Missing keys: homepage without apiKey/clientKey → fetchCurrentWeek() rejects.
 *   6. Per-term resilience: a term whose request rejects OR returns HTTP 500 is
 *      skipped; offers from other terms still returned.
 */

import { describe, test, expect } from "bun:test";
import { MarktguruEdekaCatalogueFetcher, EDEKA_ADVERTISERS, NO_BRAND_SENTINEL } from "./marktguru-edeka-catalogue-fetcher.ts";
import type { LogLevel, Logger } from "../../shared/logger.ts";

// ── Spy logger ────────────────────────────────────────────────────────────────

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

// ── Response helper ─────────────────────────────────────────────────────────────

interface ResponseOptions {
  ok?: boolean;
  status?: number;
  body?: string;
  json?: unknown;
}

function makeResponse(opts: ResponseOptions): Response {
  const status = opts.status ?? 200;
  return {
    ok: opts.ok ?? (status >= 200 && status < 300),
    status,
    text: async () => opts.body ?? "",
    json: async () => {
      if (opts.json === undefined) throw new Error("not JSON");
      return opts.json;
    },
    headers: new Headers(),
  } as unknown as Response;
}

const HOMEPAGE_WITH_KEYS = `<html><head><script>window.__CONFIG__={"apiKey":"AK","clientKey":"CK","other":"x"}</script></head><body>marktguru</body></html>`;
const HOMEPAGE_URL = "https://www.marktguru.de/";

interface RecordedRequest {
  url: string;
  headers: Record<string, string>;
}

/** Builds a single Edeka offer with sane defaults. */
function edekaOffer(overrides: Partial<{
  id: number;
  productId: number;
  productName: string;
  brandName: string | null;
  price: number;
  oldPrice: number | null;
  advertiser: string;
  categoryName: string;
  validTo: string[];
}> = {}) {
  const validTo = overrides.validTo ?? ["2026-07-20T00:00:00Z"];
  const id = overrides.id ?? 1;
  return {
    id,
    product: { id: overrides.productId ?? id, name: overrides.productName ?? "Gouda" },
    brand: overrides.brandName === undefined ? { name: "Milbona" } : (overrides.brandName === null ? null : { name: overrides.brandName }),
    price: overrides.price ?? 1.99,
    oldPrice: overrides.oldPrice === undefined ? 2.99 : overrides.oldPrice,
    categories: [{ name: overrides.categoryName ?? "Käse" }],
    advertisers: [{ uniqueName: overrides.advertiser ?? "edeka", name: "EDEKA" }],
    validityDates: validTo.map((to) => ({ from: "2026-07-14T00:00:00Z", to })),
  };
}

/**
 * Builds a fake fetch that serves HOMEPAGE_WITH_KEYS on the homepage and looks up
 * canned offer results per search term (matched on `q=<term>` in the URL). Records
 * every request. `errorTerms` map a term to "reject" | "500".
 */
function makeFakeFetch(config: {
  homepage?: string;
  offersByTerm: Record<string, unknown[]>;
  errorTerms?: Record<string, "reject" | "500">;
  recorded: RecordedRequest[];
}): typeof fetch {
  const homepage = config.homepage ?? HOMEPAGE_WITH_KEYS;
  return (async (url: Parameters<typeof fetch>[0], init?: RequestInit): Promise<Response> => {
    const urlStr = String(url);
    const headers: Record<string, string> = {};
    if (init?.headers) {
      for (const [k, v] of Object.entries(init.headers as Record<string, string>)) {
        headers[k.toLowerCase()] = v;
      }
    }
    config.recorded.push({ url: urlStr, headers });

    if (urlStr === HOMEPAGE_URL) {
      return makeResponse({ body: homepage });
    }

    // Search call — extract the q= term.
    const match = /[?&]q=([^&]+)/.exec(urlStr);
    const term = match?.[1] ? decodeURIComponent(match[1]) : "";
    const err = config.errorTerms?.[term];
    if (err === "reject") throw new Error(`network down for ${term}`);
    if (err === "500") return makeResponse({ ok: false, status: 500, body: "server error" });

    const results = config.offersByTerm[term] ?? [];
    return makeResponse({ json: { results } });
  }) as unknown as typeof fetch;
}

// ── 1. Bootstrap keys sent as headers ───────────────────────────────────────────

describe("MarktguruEdekaCatalogueFetcher — bootstrap keys", () => {
  test("scrapes apiKey/clientKey from the homepage and sends them as x-apikey/x-clientkey on search calls", async () => {
    const recorded: RecordedRequest[] = [];
    const fetchFn = makeFakeFetch({
      offersByTerm: { käse: [edekaOffer()] },
      recorded,
    });

    const fetcher = new MarktguruEdekaCatalogueFetcher({
      searchTerms: ["käse"],
      fetchFn,
      logger: new SpyLogger(),
    });
    await fetcher.fetchCurrentWeek();

    const searchReqs = recorded.filter((r) => r.url.includes("/offers/search"));
    expect(searchReqs.length).toBeGreaterThan(0);
    for (const req of searchReqs) {
      expect(req.headers["x-apikey"]).toBe("AK");
      expect(req.headers["x-clientkey"]).toBe("CK");
      expect(req.headers["user-agent"]).toBeDefined();
    }
  });
});

// ── 2. Edeka-family filter ──────────────────────────────────────────────────────

describe("MarktguruEdekaCatalogueFetcher — advertiser filter", () => {
  test("keeps only edeka; drops edeka-center and edeka-xpress (store formats) and non-Edeka advertisers (lidl)", async () => {
    const recorded: RecordedRequest[] = [];
    const kept = EDEKA_ADVERTISERS[0]!;
    const fetchFn = makeFakeFetch({
      offersByTerm: {
        milch: [
          edekaOffer({ id: 1, advertiser: kept, productName: "Vollmilch" }),
          edekaOffer({ id: 2, advertiser: "edeka-center", productName: "Butter" }),
          edekaOffer({ id: 3, advertiser: "edeka-xpress", productName: "Sahne" }),
          edekaOffer({ id: 4, advertiser: "lidl", productName: "Quark" }),
        ],
      },
      recorded,
    });

    const fetcher = new MarktguruEdekaCatalogueFetcher({
      searchTerms: ["milch"],
      fetchFn,
      logger: new SpyLogger(),
    });
    const result = await fetcher.fetchCurrentWeek();

    const ids = result.map((i) => i.id).sort();
    expect(ids).toEqual(["1"]);
    const titles = result.map((i) => i.title).join(" ");
    expect(titles).toContain("Vollmilch");
    expect(titles).not.toContain("Butter");
    expect(titles).not.toContain("Sahne");
    expect(titles).not.toContain("Quark");
  });
});

// ── 3. Dedupe ───────────────────────────────────────────────────────────────────

describe("MarktguruEdekaCatalogueFetcher — dedupe", () => {
  test("the same offer.id returned by two search terms yields exactly one item", async () => {
    const recorded: RecordedRequest[] = [];
    const shared = edekaOffer({ id: 99, productName: "Gouda" });
    const fetchFn = makeFakeFetch({
      offersByTerm: {
        käse: [shared],
        wurst: [shared],
      },
      recorded,
    });

    const fetcher = new MarktguruEdekaCatalogueFetcher({
      searchTerms: ["käse", "wurst"],
      fetchFn,
      logger: new SpyLogger(),
    });
    const result = await fetcher.fetchCurrentWeek();

    expect(result.filter((i) => i.id === "99")).toHaveLength(1);
    expect(result).toHaveLength(1);
  });
});

// ── 3b. Secondary dedupe by (product.id, price) ─────────────────────────────────

describe("MarktguruEdekaCatalogueFetcher — secondary dedupe by (product.id, price)", () => {
  test("same productId + same price, different offer.id → exactly one item", async () => {
    const recorded: RecordedRequest[] = [];
    const fetchFn = makeFakeFetch({
      offersByTerm: {
        milch: [
          edekaOffer({ id: 100, productId: 500, price: 1.99, productName: "Vollmilch" }),
          edekaOffer({ id: 101, productId: 500, price: 1.99, productName: "Vollmilch" }),
        ],
      },
      recorded,
    });

    const fetcher = new MarktguruEdekaCatalogueFetcher({
      searchTerms: ["milch"],
      fetchFn,
      logger: new SpyLogger(),
    });
    const result = await fetcher.fetchCurrentWeek();

    expect(result).toHaveLength(1);
  });

  test("same productId + different price → two items (genuine variants both survive)", async () => {
    const recorded: RecordedRequest[] = [];
    const fetchFn = makeFakeFetch({
      offersByTerm: {
        milch: [
          edekaOffer({ id: 200, productId: 600, price: 1.99, productName: "Vollmilch" }),
          edekaOffer({ id: 201, productId: 600, price: 2.49, productName: "Vollmilch" }),
        ],
      },
      recorded,
    });

    const fetcher = new MarktguruEdekaCatalogueFetcher({
      searchTerms: ["milch"],
      fetchFn,
      logger: new SpyLogger(),
    });
    const result = await fetcher.fetchCurrentWeek();

    expect(result).toHaveLength(2);
  });

  test("tie-break: same productId + same price, offer with oldPrice wins over the null-oldPrice one", async () => {
    const recorded: RecordedRequest[] = [];
    const fetchFn = makeFakeFetch({
      offersByTerm: {
        milch: [
          edekaOffer({ id: 300, productId: 700, price: 1.99, oldPrice: null, productName: "Vollmilch" }),
          edekaOffer({ id: 301, productId: 700, price: 1.99, oldPrice: 2.99, productName: "Vollmilch" }),
        ],
      },
      recorded,
    });

    const fetcher = new MarktguruEdekaCatalogueFetcher({
      searchTerms: ["milch"],
      fetchFn,
      logger: new SpyLogger(),
    });
    const result = await fetcher.fetchCurrentWeek();

    expect(result).toHaveLength(1);
    expect(result[0]!.price).toBe(String(2.99)); // survivor is the offer WITH oldPrice
  });

  test("missing productId → key falls back to product name (same name + price, different offer.id → one item)", async () => {
    const recorded: RecordedRequest[] = [];
    // Raw inline offers WITHOUT product.id, so the key falls back to product.name.
    // Deliberately not built via edekaOffer (which always sets product.id).
    const fetchFn = makeFakeFetch({
      offersByTerm: {
        milch: [
          {
            id: 400,
            product: { name: "Vollmilch" },
            brand: null,
            price: 1.99,
            oldPrice: null,
            categories: [{ name: "Milch" }],
            advertisers: [{ uniqueName: "edeka", name: "EDEKA" }],
            validityDates: [{ from: "2026-07-14T00:00:00Z", to: "2026-07-20T00:00:00Z" }],
          },
          {
            id: 401,
            product: { name: "Vollmilch" },
            brand: null,
            price: 1.99,
            oldPrice: null,
            categories: [{ name: "Milch" }],
            advertisers: [{ uniqueName: "edeka", name: "EDEKA" }],
            validityDates: [{ from: "2026-07-14T00:00:00Z", to: "2026-07-20T00:00:00Z" }],
          },
        ],
      },
      recorded,
    });

    const fetcher = new MarktguruEdekaCatalogueFetcher({
      searchTerms: ["milch"],
      fetchFn,
      logger: new SpyLogger(),
    });
    const result = await fetcher.fetchCurrentWeek();

    expect(result).toHaveLength(1);
  });
});

// ── 4. Mapping + equal-price survival ───────────────────────────────────────────

describe("MarktguruEdekaCatalogueFetcher — mapping", () => {
  test("regular==oldPrice when oldPrice present; title=brand+product; validUntil is full YYYY-MM-DD (latest to); productType from category", async () => {
    const recorded: RecordedRequest[] = [];
    const fetchFn = makeFakeFetch({
      offersByTerm: {
        käse: [
          edekaOffer({
            id: 7,
            brandName: "Milbona",
            productName: "Gouda jung",
            price: 1.99,
            oldPrice: 2.99,
            categoryName: "Käse",
            validTo: ["2026-07-18T00:00:00Z", "2026-07-22T00:00:00Z", "2026-07-20T00:00:00Z"],
          }),
        ],
      },
      recorded,
    });

    const fetcher = new MarktguruEdekaCatalogueFetcher({
      searchTerms: ["käse"],
      fetchFn,
      logger: new SpyLogger(),
    });
    const result = await fetcher.fetchCurrentWeek();

    expect(result).toHaveLength(1);
    const item = result[0]!;
    expect(item.id).toBe("7");
    expect(item.title).toBe("Milbona Gouda jung");
    expect(item.brand).toBe("EDEKA");
    expect(item.price).toBe("2.99"); // regular = oldPrice
    expect(item.discountedPrice).toBe("1.99"); // sale = price
    expect(item.customLabel1).toBe("2026-07-22"); // latest .to, full date
    expect(item.customLabel1).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(item.productType).toBe("Käse");
    expect(item.photoUrls).toEqual([]);
    // sourceUrl is a per-offer deep link built from the offer id.
    expect(item.sourceUrl).toBe("https://www.marktguru.de/offers/7");
  });

  test("equal-price survival: oldPrice null → regular==sale AND item present (no drop filter)", async () => {
    const recorded: RecordedRequest[] = [];
    const fetchFn = makeFakeFetch({
      offersByTerm: {
        brot: [
          edekaOffer({
            id: 42,
            brandName: null, // no brand → title = product name only
            productName: "Bauernbrot",
            price: 1.49,
            oldPrice: null, // equal-price offer
          }),
        ],
      },
      recorded,
    });

    const fetcher = new MarktguruEdekaCatalogueFetcher({
      searchTerms: ["brot"],
      fetchFn,
      logger: new SpyLogger(),
    });
    const result = await fetcher.fetchCurrentWeek();

    expect(result).toHaveLength(1);
    const item = result[0]!;
    expect(item.id).toBe("42");
    expect(item.title).toBe("Bauernbrot");
    expect(item.price).toBe("1.49");
    expect(item.discountedPrice).toBe("1.49");
    expect(item.price).toBe(item.discountedPrice); // equal-price survives
  });

  test("sentinel no-brand: brand name is the marktguru no-brand sentinel → title = product name only (sentinel not leaked into title)", async () => {
    const recorded: RecordedRequest[] = [];
    const fetchFn = makeFakeFetch({
      offersByTerm: {
        hähnchen: [
          edekaOffer({
            id: 55,
            brandName: `${NO_BRAND_SENTINEL}123`, // marktguru sentinel brand for no-brand products
            productName: "Hähnchen-Schenkel",
          }),
        ],
      },
      recorded,
    });

    const fetcher = new MarktguruEdekaCatalogueFetcher({
      searchTerms: ["hähnchen"],
      fetchFn,
      logger: new SpyLogger(),
    });
    const result = await fetcher.fetchCurrentWeek();

    expect(result).toHaveLength(1);
    expect(result[0]!.title).toBe("Hähnchen-Schenkel");
  });

  test("no validityDates → validUntil falls back to currentWeekSunday (full YYYY-MM-DD)", async () => {
    const recorded: RecordedRequest[] = [];
    const offer = edekaOffer({ id: 5, validTo: [] });
    const fetchFn = makeFakeFetch({
      offersByTerm: { obst: [offer] },
      recorded,
    });

    const fetcher = new MarktguruEdekaCatalogueFetcher({
      searchTerms: ["obst"],
      fetchFn,
      logger: new SpyLogger(),
    });
    const result = await fetcher.fetchCurrentWeek();

    expect(result).toHaveLength(1);
    expect(result[0]!.customLabel1).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

// ── 5. Missing keys → reject ─────────────────────────────────────────────────────

describe("MarktguruEdekaCatalogueFetcher — missing bootstrap keys", () => {
  test("homepage without apiKey/clientKey → fetchCurrentWeek() rejects with a clear error", async () => {
    const recorded: RecordedRequest[] = [];
    const fetchFn = makeFakeFetch({
      homepage: "<html><body>no config here</body></html>",
      offersByTerm: { käse: [edekaOffer()] },
      recorded,
    });

    const fetcher = new MarktguruEdekaCatalogueFetcher({
      searchTerms: ["käse"],
      fetchFn,
      logger: new SpyLogger(),
    });

    await expect(fetcher.fetchCurrentWeek()).rejects.toThrow(/apiKey\/clientKey not found/);
  });
});

// ── 6. Per-term resilience ───────────────────────────────────────────────────────

describe("MarktguruEdekaCatalogueFetcher — per-term resilience", () => {
  test("a term whose request REJECTS is skipped; offers from other terms are returned", async () => {
    const recorded: RecordedRequest[] = [];
    const fetchFn = makeFakeFetch({
      offersByTerm: {
        wurst: [edekaOffer({ id: 11, productName: "Salami" })],
      },
      errorTerms: { käse: "reject" },
      recorded,
    });

    const spy = new SpyLogger();
    const fetcher = new MarktguruEdekaCatalogueFetcher({
      searchTerms: ["käse", "wurst"],
      fetchFn,
      logger: spy,
    });
    const result = await fetcher.fetchCurrentWeek();

    expect(result.map((i) => i.id)).toEqual(["11"]);
  });

  test("a term whose request returns HTTP 500 is skipped; offers from other terms are returned", async () => {
    const recorded: RecordedRequest[] = [];
    const fetchFn = makeFakeFetch({
      offersByTerm: {
        wurst: [edekaOffer({ id: 12, productName: "Schinken" })],
      },
      errorTerms: { käse: "500" },
      recorded,
    });

    const fetcher = new MarktguruEdekaCatalogueFetcher({
      searchTerms: ["käse", "wurst"],
      fetchFn,
      logger: new SpyLogger(),
    });
    const result = await fetcher.fetchCurrentWeek();

    expect(result.map((i) => i.id)).toEqual(["12"]);
  });
});
