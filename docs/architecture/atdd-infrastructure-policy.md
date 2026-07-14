# ATDD Infrastructure Policy — discount-hunt

*Project-level policy. Specifies the mechanism per port class used in acceptance tests.*
*Created in DISTILL wave S01. Append rows as new ports enter scope in future slices.*

---

## Language + Runtime

| Item | Value |
|------|-------|
| Language | TypeScript |
| Runtime | Bun |
| Test framework | `bun test` (built-in, `bun:test`) |
| Policy mode | inherit (default) |

---

## Driving Ports

| Port class | Mechanism | Notes |
|-----------|-----------|-------|
| HTTP routes (`GET /`, `POST /plan/generate`, `GET /savings`, etc.) | Real `Bun.serve` started on a random port per test file; torn down via `server.stop()` in `afterAll` | Production composition root (`src/server.ts`) is the entry point; no mock server |
| CLI scraper (`bun run src/scraping/scraper-runner.ts`) | `Bun.spawnSync(["bun", "run", "src/scraping/scraper-runner.ts", ...])` capturing `stdout` + `exitCode` | Subprocess reads `CATALOGUE_SOURCE` env var; when `CATALOGUE_SOURCE=fake`, reads fixture JSON from `FAKE_CATALOGUE_FIXTURE` env var path instead of hitting `prospekt.aldi-sued.de`; subprocess and in-process server share the same SQLite file path (passed via `TEST_DB_PATH` env var) |

---

## Driven Internal Ports (SQLite repositories)

| Port class | Mechanism | Notes |
|-----------|-----------|-------|
| All SQLite repositories (`ScrapeJobRepository`, `DiscountItemRepository`, `MealPlanRepository`, `SavingsRepository`, `RecipeRepository`, `PreferencesRepository`) | Real SQLite file in `os.tmpdir()` created per test file via `mkdtemp`; uses `drizzle-orm/better-sqlite3`; WAL mode enabled | Fresh DB per test suite; no shared state between test files; path passed as `TEST_DB_PATH` env var so the scraper subprocess writes to the same file the in-process server reads from |

---

## Driven External Ports

| Port class | Mechanism | Notes |
|-----------|-----------|-------|
| Aldi Süd catalogue HTTP (`CatalogueFetcher`) | `FakeAldiCatalogueAdapter` — in-memory, injected via port; when CLI subprocess: fixture JSON written to tmp file + `FAKE_CATALOGUE_FIXTURE` env var set | Fixture must include items with BOTH `price` and `discountedPrice` (happy path) or `price`-only items (error path); `price > discountedPrice` invariant enforced in fixture per D22 |
| Chefkoch recipe fetcher (`RecipeFetcher`) | `FakeChefkochFetcher` — in-memory, injected via port | S01 plan-service uses hardcoded stub URL; real integration deferred to S05 |
| Brave Search API (`RecipeSearchClient`) | `FakeBraveSearchClient` — in-memory, injected via port | OQ-1 unresolved; fake covers S01 walking skeleton; real validation deferred to S05 |

---

## Fail-for-Right-Reason Classification

Tests in this project use RED scaffolds (every scaffold stub `throw new Error("Not yet implemented — RED scaffold")`). The formal fail-for-right-reason classification (BROKEN vs RED) is deferred to DELIVER PREPARE phase, after `bun install` completes and the module graph resolves. BROKEN = import/type error (not a business logic failure). RED = test reaches production code path and fails on an assertion.

---

## CLI Subprocess — Fake Injection Seam

The CLI scraper runs as a subprocess (`Bun.spawnSync`). The fake Aldi catalogue is injected via environment variables rather than in-process constructor injection:

1. Test writes `FakeAldiCatalogueAdapter` fixture as JSON to a tmp file.
2. Test spawns scraper subprocess with `{ env: { CATALOGUE_SOURCE: "fake", FAKE_CATALOGUE_FIXTURE: "/tmp/.../fixture.json", TEST_DB_PATH: "/tmp/.../test.db" } }`.
3. `scraper-runner.ts` reads `CATALOGUE_SOURCE`; if `"fake"`, instantiates `FakeAldiCatalogueAdapter` (file-backed) instead of `AldiSudCatalogueFetcher`.
4. Subprocess writes scraped items to `TEST_DB_PATH`.
5. In-process `Bun.serve` (started with same `TEST_DB_PATH`) reads the written rows.

This seam keeps the CLI driving-adapter test real (actual subprocess + exit code) while eliminating live network I/O in CI.
