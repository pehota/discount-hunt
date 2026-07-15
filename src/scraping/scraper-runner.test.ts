/**
 * scraper-runner unit tests — wiring + resilience tests for runLiveScrape factory.
 *
 * Properties / behaviours tested (step 09-01 contract):
 *   AC1 — per-store isolation: one store failing is recorded + skipped; the run
 *           continues with the others and does NOT reject. Summary records the
 *           per-store outcome as {store, ok, error?}.
 *   AC2 — LLM decoupling: an unconfigured catalogue LLM no longer aborts the run.
 *           Aldi Süd still attempts; the V-Markt leg is skipped with a recorded
 *           reason and makeVMarktFetcher is NOT constructed.
 *   AC3 — exit semantics: exit 0 if >=1 store ok, exit 1 only if ALL failed
 *           (verified through the exported pure mapper `exitCodeFor`).
 *
 * Approach:
 *   - Inject stub runScrape and stub fetcher factories to keep tests in-process,
 *     free of DB/HTTP/Anthropic dependencies.
 *   - Manage the catalogue-LLM env (ANTHROPIC_API_KEY + CATALOGUE_LLM_*) per-test
 *     (explicit set/delete) with afterEach restore so no state leaks. The default
 *     anthropic provider resolves a model when a key is present, else null.
 *
 * bypass: wiring tests verify composition/summary shape, not invariants —
 * example-based is correct here.
 */

import { describe, test, expect, afterEach } from "bun:test";
import { runLiveScrape, exitCodeFor, LLM_NOT_CONFIGURED } from "./scraper-runner.ts";
import type { LogLevel, Logger } from "../shared/logger.ts";

// ── Spy logger for structured-event assertions ────────────────────────────────

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

// ── Env save/restore ──────────────────────────────────────────────────────────

// Catalogue-LLM env vars that steer resolveCatalogueLlm — saved once, restored
// after each test so provider config never leaks between tests or files.
const LLM_ENV_KEYS = [
  "ANTHROPIC_API_KEY",
  "CATALOGUE_LLM_PROVIDER",
  "CATALOGUE_LLM_MODEL",
  "CATALOGUE_LLM_BASE_URL",
  "CATALOGUE_LLM_API_KEY",
] as const;

const ORIGINAL_LLM_ENV: Record<string, string | undefined> = Object.fromEntries(
  LLM_ENV_KEYS.map((k) => [k, process.env[k]])
);

afterEach(() => {
  for (const k of LLM_ENV_KEYS) {
    const original = ORIGINAL_LLM_ENV[k];
    if (original === undefined) {
      delete process.env[k];
    } else {
      process.env[k] = original;
    }
  }
});

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Minimal stub for CatalogueFetcher port. */
function stubFetcher(name: string) {
  return {
    name,
    fetchCurrentWeek: async () => [],
  };
}

/** Finds a per-store summary entry by store name. */
function entryFor(summary: Array<{ store: string; ok: boolean; error?: string }>, store: string) {
  const entry = summary.find((s) => s.store === store);
  if (!entry) throw new Error(`no summary entry for store ${store}`);
  return entry;
}

/** Clears every catalogue-LLM env var so resolveCatalogueLlm returns null. */
function clearLlmEnv(): void {
  for (const k of LLM_ENV_KEYS) delete process.env[k];
}

// ── AC1: per-store isolation + wiring ──────────────────────────────────────────

describe("runLiveScrape — per-store isolation", () => {
  // bypass: wiring test verifies composition + summary shape, not invariants.

  test("attempts both stores and returns an ok summary when both succeed", async () => {
    process.env.ANTHROPIC_API_KEY = "dummy-key-for-test";

    const scraped: Array<{ fetcherName: string; store: string }> = [];
    const aldiStub = stubFetcher("AldiSudCatalogueFetcher");
    const vMarktStub = stubFetcher("VMarktCatalogueFetcher");

    const summary = await runLiveScrape({
      makeAldiFetcher: () => aldiStub,
      makeVMarktFetcher: () => vMarktStub,
      runScrape: async (fetcher, store) => {
        scraped.push({ fetcherName: (fetcher as typeof aldiStub).name, store });
      },
    });

    expect(scraped.map((s) => s.store)).toContain("Aldi Süd");
    expect(scraped.map((s) => s.store)).toContain("V-Markt");
    expect(scraped).toHaveLength(2);

    expect(entryFor(summary, "Aldi Süd").ok).toBe(true);
    expect(entryFor(summary, "V-Markt").ok).toBe(true);
  });

  test("passes the correct fetcher to each store's scrape call", async () => {
    process.env.ANTHROPIC_API_KEY = "dummy-key-for-test";

    const aldiStub = stubFetcher("AldiSudCatalogueFetcher");
    const vMarktStub = stubFetcher("VMarktCatalogueFetcher");
    let aldiRunWith: unknown = null;
    let vMarktRunWith: unknown = null;

    await runLiveScrape({
      makeAldiFetcher: () => aldiStub,
      makeVMarktFetcher: () => vMarktStub,
      runScrape: async (fetcher, store) => {
        if (store === "Aldi Süd") aldiRunWith = fetcher;
        if (store === "V-Markt") vMarktRunWith = fetcher;
      },
    });

    expect(aldiRunWith).toBe(aldiStub);
    expect(vMarktRunWith).toBe(vMarktStub);
  });

  test("V-Markt failure does not abort the run; Aldi still scrapes and both are recorded", async () => {
    process.env.ANTHROPIC_API_KEY = "dummy-key-for-test";

    const attempted: string[] = [];

    const summary = await runLiveScrape({
      makeAldiFetcher: () => stubFetcher("Aldi"),
      makeVMarktFetcher: () => stubFetcher("VMarkt"),
      runScrape: async (_fetcher, store) => {
        attempted.push(store);
        if (store === "V-Markt") throw new Error("VMarktCatalogueFetcher failed");
      },
    });

    expect(attempted).toContain("Aldi Süd");
    expect(attempted).toContain("V-Markt");

    expect(entryFor(summary, "Aldi Süd").ok).toBe(true);
    const vMarkt = entryFor(summary, "V-Markt");
    expect(vMarkt.ok).toBe(false);
    expect(vMarkt.error).toContain("VMarktCatalogueFetcher failed");
  });

  test("Aldi failure does not abort the run; V-Markt still scrapes and both are recorded", async () => {
    process.env.ANTHROPIC_API_KEY = "dummy-key-for-test";

    const attempted: string[] = [];

    const summary = await runLiveScrape({
      makeAldiFetcher: () => stubFetcher("Aldi"),
      makeVMarktFetcher: () => stubFetcher("VMarkt"),
      runScrape: async (_fetcher, store) => {
        attempted.push(store);
        if (store === "Aldi Süd") throw new Error("AldiSudCatalogueFetcher failed");
      },
    });

    expect(attempted).toContain("Aldi Süd");
    expect(attempted).toContain("V-Markt");

    const aldi = entryFor(summary, "Aldi Süd");
    expect(aldi.ok).toBe(false);
    expect(aldi.error).toContain("AldiSudCatalogueFetcher failed");
    expect(entryFor(summary, "V-Markt").ok).toBe(true);
  });
});

// ── AC2: catalogue-LLM decoupling ──────────────────────────────────────────────

describe("runLiveScrape — catalogue-LLM decoupling", () => {
  // bypass: wiring test verifies composition + summary shape, not invariants.

  test("with no LLM configured: Aldi still scrapes, V-Markt is skipped with a recorded reason, and makeVMarktFetcher is NOT called", async () => {
    clearLlmEnv();

    const attempted: string[] = [];
    let vMarktFetcherConstructions = 0;

    const summary = await runLiveScrape({
      makeAldiFetcher: () => stubFetcher("Aldi"),
      makeVMarktFetcher: () => {
        vMarktFetcherConstructions += 1;
        return stubFetcher("VMarkt");
      },
      runScrape: async (_fetcher, store) => {
        attempted.push(store);
      },
    });

    // Aldi is attempted; V-Markt is not run (fetcher never constructed).
    expect(attempted).toContain("Aldi Süd");
    expect(attempted).not.toContain("V-Markt");
    expect(vMarktFetcherConstructions).toBe(0);

    // Summary records Aldi success and V-Markt skip-with-reason.
    expect(entryFor(summary, "Aldi Süd").ok).toBe(true);
    const vMarkt = entryFor(summary, "V-Markt");
    expect(vMarkt.ok).toBe(false);
    expect(vMarkt.error).toBe(LLM_NOT_CONFIGURED);
  });

  test("with no LLM configured: the run does not reject even if it is the only successful store", async () => {
    clearLlmEnv();

    await expect(
      runLiveScrape({
        makeAldiFetcher: () => stubFetcher("Aldi"),
        makeVMarktFetcher: () => stubFetcher("VMarkt"),
        runScrape: async () => {},
      })
    ).resolves.toBeDefined();
  });
});

// ── 10-02: structured logging for the skipped-store reason ─────────────────────

describe("runLiveScrape — structured logging", () => {
  // bypass: interaction test over a spy logger — verifies emitted event, not an invariant.

  test("with no LLM configured: emits a structured summary event for the skipped V-Markt leg", async () => {
    clearLlmEnv();
    const spy = new SpyLogger();

    await runLiveScrape({
      makeAldiFetcher: () => stubFetcher("Aldi"),
      makeVMarktFetcher: () => stubFetcher("VMarkt"),
      runScrape: async () => {},
      logger: spy,
    });

    const vmarkt = spy.find("scrape.summary");
    expect(vmarkt).toBeDefined();
    expect(spy.events.some((e) => e.event === "scrape.summary" && e.fields.store === "V-Markt" && e.fields.ok === false)).toBe(true);
  });
});

// ── AC3: exit-code mapping (pure helper) ───────────────────────────────────────

describe("exitCodeFor — summary to exit code mapping", () => {
  // bypass: pure-function mapping test — single output, no side effects.

  test("returns 0 when at least one store is ok", () => {
    expect(
      exitCodeFor([
        { store: "Aldi Süd", ok: true },
        { store: "V-Markt", ok: false, error: "boom" },
      ])
    ).toBe(0);
  });

  test("returns 0 when all stores are ok", () => {
    expect(
      exitCodeFor([
        { store: "Aldi Süd", ok: true },
        { store: "V-Markt", ok: true },
      ])
    ).toBe(0);
  });

  test("returns 1 when all stores failed", () => {
    expect(
      exitCodeFor([
        { store: "Aldi Süd", ok: false, error: "boom" },
        { store: "V-Markt", ok: false, error: "ANTHROPIC_API_KEY missing" },
      ])
    ).toBe(1);
  });

  test("returns 1 when the summary is empty (no store attempted)", () => {
    expect(exitCodeFor([])).toBe(1);
  });
});
