/**
 * scraper-runner unit tests — wiring tests for runLiveScrape factory.
 *
 * Properties / behaviours tested:
 *   AC1 — live mode wires AldiSudCatalogueFetcher and VMarktCatalogueFetcher
 *           with HaikuCatalogueExtractor and calls runScrape for both stores.
 *   AC2 — live mode resolves (exit 0 proxy) when all runScrape calls succeed.
 *   AC3 — live mode rejects (exit 1 proxy) when a fetcher throws.
 *   AC4 — fake mode is unaffected: acceptance tests cover this via subprocess.
 *
 * Approach:
 *   - Inject stub runScrape and stub fetcher factories to keep tests in-process,
 *     free of DB/HTTP/Anthropic dependencies.
 *   - Set a dummy ANTHROPIC_API_KEY in env (save/restore pattern) to pass the
 *     key-check gate without a real key.
 *   - `test.skipIf(!process.env.ANTHROPIC_API_KEY)` is NOT used here because
 *     the stubs bypass Haiku construction entirely.
 *
 * bypass: wiring tests verify composition, not invariants — example-based is correct here.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { runLiveScrape } from "./scraper-runner.ts";

// ── Env save/restore ──────────────────────────────────────────────────────────

const ORIGINAL_API_KEY = process.env.ANTHROPIC_API_KEY;

afterEach(() => {
  if (ORIGINAL_API_KEY === undefined) {
    delete process.env.ANTHROPIC_API_KEY;
  } else {
    process.env.ANTHROPIC_API_KEY = ORIGINAL_API_KEY;
  }
});

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Minimal stub for CatalogueFetcher port. */
function stubFetcher(name: string, reject = false) {
  return {
    name,
    fetchCurrentWeek: reject
      ? async () => { throw new Error(`${name} failed`); }
      : async () => [],
  };
}

// ── AC1 + AC2: live mode wires both stores and resolves on success ─────────────

describe("runLiveScrape — live wiring", () => {
  // bypass: wiring test verifies composition, not invariants.

  test("calls runScrape for both Aldi Süd and V-Markt when ANTHROPIC_API_KEY is set", async () => {
    process.env.ANTHROPIC_API_KEY = "dummy-key-for-test";

    const scraped: Array<{ fetcherName: string; store: string }> = [];

    const aldiStub = stubFetcher("AldiSudCatalogueFetcher");
    const vMarktStub = stubFetcher("VMarktCatalogueFetcher");

    await runLiveScrape({
      makeAldiFetcher: () => aldiStub,
      makeVMarktFetcher: () => vMarktStub,
      runScrape: async (fetcher, store) => {
        scraped.push({ fetcherName: (fetcher as typeof aldiStub).name, store });
      },
    });

    const stores = scraped.map((s) => s.store);
    expect(stores).toContain("Aldi Süd");
    expect(stores).toContain("V-Markt");
    expect(scraped).toHaveLength(2);
  });

  test("passes the Aldi fetcher to the Aldi Süd scrape call", async () => {
    process.env.ANTHROPIC_API_KEY = "dummy-key-for-test";

    const aldiStub = stubFetcher("AldiSudCatalogueFetcher");
    const vMarktStub = stubFetcher("VMarktCatalogueFetcher");
    let aldiRunWith: unknown = null;

    await runLiveScrape({
      makeAldiFetcher: () => aldiStub,
      makeVMarktFetcher: () => vMarktStub,
      runScrape: async (fetcher, store) => {
        if (store === "Aldi Süd") aldiRunWith = fetcher;
      },
    });

    expect(aldiRunWith).toBe(aldiStub);
  });

  test("passes the V-Markt fetcher to the V-Markt scrape call", async () => {
    process.env.ANTHROPIC_API_KEY = "dummy-key-for-test";

    const aldiStub = stubFetcher("AldiSudCatalogueFetcher");
    const vMarktStub = stubFetcher("VMarktCatalogueFetcher");
    let vMarktRunWith: unknown = null;

    await runLiveScrape({
      makeAldiFetcher: () => aldiStub,
      makeVMarktFetcher: () => vMarktStub,
      runScrape: async (fetcher, store) => {
        if (store === "V-Markt") vMarktRunWith = fetcher;
      },
    });

    expect(vMarktRunWith).toBe(vMarktStub);
  });

  test("resolves (exit 0 proxy) when both scrape calls succeed", async () => {
    process.env.ANTHROPIC_API_KEY = "dummy-key-for-test";

    await expect(
      runLiveScrape({
        makeAldiFetcher: () => stubFetcher("Aldi"),
        makeVMarktFetcher: () => stubFetcher("VMarkt"),
        runScrape: async () => {},
      })
    ).resolves.toBeUndefined();
  });
});

// ── AC3: live mode rejects when a fetcher throws ──────────────────────────────

describe("runLiveScrape — error propagation", () => {
  // bypass: wiring test verifies composition, not invariants.

  test("rejects (exit 1 proxy) when Aldi runScrape rejects", async () => {
    process.env.ANTHROPIC_API_KEY = "dummy-key-for-test";

    await expect(
      runLiveScrape({
        makeAldiFetcher: () => stubFetcher("Aldi"),
        makeVMarktFetcher: () => stubFetcher("VMarkt"),
        runScrape: async (_fetcher, store) => {
          if (store === "Aldi Süd") throw new Error("AldiSudCatalogueFetcher failed");
        },
      })
    ).rejects.toThrow("AldiSudCatalogueFetcher failed");
  });

  test("rejects (exit 1 proxy) when V-Markt runScrape rejects", async () => {
    process.env.ANTHROPIC_API_KEY = "dummy-key-for-test";

    await expect(
      runLiveScrape({
        makeAldiFetcher: () => stubFetcher("Aldi"),
        makeVMarktFetcher: () => stubFetcher("VMarkt"),
        runScrape: async (_fetcher, store) => {
          if (store === "V-Markt") throw new Error("VMarktCatalogueFetcher failed");
        },
      })
    ).rejects.toThrow("VMarktCatalogueFetcher failed");
  });
});

// ── Missing ANTHROPIC_API_KEY: guard check ─────────────────────────────────────

describe("runLiveScrape — ANTHROPIC_API_KEY guard", () => {
  test("throws when ANTHROPIC_API_KEY is absent", async () => {
    delete process.env.ANTHROPIC_API_KEY;

    await expect(
      runLiveScrape({
        makeAldiFetcher: () => stubFetcher("Aldi"),
        makeVMarktFetcher: () => stubFetcher("VMarkt"),
        runScrape: async () => {},
      })
    ).rejects.toThrow();
  });
});
