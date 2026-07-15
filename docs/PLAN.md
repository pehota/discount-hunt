# discount-hunt — working plan (resume doc)

_Last updated: 2026-07-15 (end of session). This is the "pick up tomorrow" file._

## How we work (important — read first)
- **Lean build → use → improve loop.** This is a personal tool (Dimitar + wife). We do NOT run heavy nWave ceremony (DISCOVER/DISCUSS/DESIGN) for it anymore — pull the next backlog item and build it directly, TDD, ship, use, repeat. (A full DESIGN wave for `product-overhaul` was started and deliberately **stopped** in favour of this.)
- **Trunk-based**, commit straight to `main`, no PRs. Conventional commits. Split changes into logical bundles, one commit each.
- Every change: `bun run typecheck` = 0 errors AND `bun test` = 0 fail BEFORE committing. Colocated tests, OOP, ports-and-adapters.
- **Verify UI in a real browser** (Chrome DevTools), not just tests — client-JS/interaction bugs and wiring regressions hide from a green suite. Measure `scrollWidth - clientWidth` at 375px; exercise real clicks.

## Run / verify
- App: `bun run src/server.ts` → http://localhost:3000 (default DB `./discount-hunt.db`, real Aldi Süd data). Bun does NOT hot-reload — restart to pick up code changes.
- Scrape: `bun run src/scraping/scraper-runner.ts` (live mode needs network + a model key; see backlog #2).
- Multi-store demo DB: `TEST_DB_PATH=/tmp/dh-multistore.db bun run scripts/dev/seed-multistore.ts` then run the server with the same env var (NOTE: that temp DB predates the shopping-list table — reseed/recreate if reused).

## Shipped this session (committed on `main`, baseline f3acc0f)
- `4c11fc6` mobile-first "Fresh Market" redesign (0 h-overflow @375px, bottom-tab nav, savings hero, ≥44px targets)
- `d714735` multi-store feed filter pills (client-side, counts)
- `d207eb8` build meal plan from user-SELECTED feed items; Generate REPLACES the week's plan with a savings_log dedup guard (no double-count)
- `124c3d6` feed: selected-card highlight + cross-store selection overview + product-name search (all compose)
- `aa1a29c` feed: no preselection (checkboxes default unchecked) + overview is an overlay that never reflows search/tabs
- `bb7bf9e` shopping list (`src/shopping-list/`): add picked/typed items, week-scoped, snapshot-at-add, running total + "You save €X" (display-only, no savings_log write), 5th nav tab 🧾
- Docs: `adc13b7` DISCUSS discount-hunt-ui · `0eca5d6` DISCUSS product-overhaul · `3373047` product vision · `b1192b5` CLAUDE.md (TBD workflow)

## Nothing in flight
All session work is committed (latest `24dc45a`: feed add-to-list toast + overview action hub, verified in-browser). Working tree clean.

## Backlog (ordered, decisions already locked)
1. **List counter in the header nav** — the "List" 🧾 nav item shows a badge with the number of items in the shopping list.
   - How: add optional `listCount` to `renderPage`/`PageOptions`; each page handler passes the current week's shopping-list count (new `ShoppingListService.count()`); `layout.ts` renders a small badge on the List nav item when count>0. Live update: on a successful add-to-list (toast path) the feed JS increments the badge immediately (no reload); server-render keeps it accurate on nav/reload; remove decrements.
   - Verify: tests (renderPage badge when count>0 / absent at 0; handlers pass the count; service count); in-browser — List tab badge = list size, add-via-feed bumps it live, navigate persists, remove decrements; 0 overflow + badge fits the 5-tab bar @375px.
2. **Vercel AI SDK provider abstraction** — decouple LLM from Anthropic.
   - `CatalogueExtractor` port already exists (`src/scraping/adapters/catalogue-extractor.ts`); only impl is `HaikuCatalogueExtractor` (Anthropic, hardcoded `claude-haiku-4-5-20251001`, `ANTHROPIC_API_KEY`).
   - Replace with a Vercel-AI-SDK-based extractor: config-selected provider+model+base-URL (env), default = current Anthropic/Haiku to preserve behavior. Generalise the runner's `ANTHROPIC_API_KEY`-specific gating. Adds deps (`ai`, `@ai-sdk/*`) — do NOT run its `bun add` while another code agent's tests run.
   - Then **run V-Markt live** (scraper already built, text-based) to get real 2nd-store data. **NEEDS a model endpoint + key (or local Ollama URL) from Dimitar.**
3. **Hybrid product categorisation** (enables the category filter).
   - Method: **rules first** (keyword map from raw `productType`) + **LLM fallback** (via #2) for the `"unknown"` bucket (steaks/Cordon bleu/Radler have no productType keyword).
   - Taxonomy (~10 buckets): Produce · Meat & Fish · Dairy & Cheese · Bakery · Pantry (dry/canned) · Snacks & Sweets · Drinks · Frozen · Household · Other.
   - **New column** `taxonomy_category` (do NOT overwrite `category` — the dietary classifier depends on the raw German productType). Idempotent (LLM only for still-unclassified; re-runs don't re-spend). Runs as a **post-scrape step over all products** (incl. existing Aldi 31).
   - _Optional quick win:_ the rule-based half is dep-free and could land before #2 (covers most products; `"unknown"`→Other until LLM fallback added).
   - Then: **category filter on the feed** (product-overhaul slice S01) — 3rd additive filter alongside shop + name search; also price-ascending sort.
4. **Edeka** (spike done — see findings below).
   - Offers are an image-only flip-book (`blaetterkatalog.edeka.de/{REGION}/{catalogId}/blaetterkatalog/large/bk_N.jpg`, ~34 pages, weekly). **No structured product/price data** (per-page XML 404s, search disabled, no API). `catalog.xml` = page count + valid dates only.
   - So extraction = **vision/multimodal LLM over the page JPGs** (needs #2's provider abstraction with a vision model). Plus **store→catalog-id resolution** for a Munich Edeka (the site auto-picks a random market; how to resolve by location is unsolved).
   - Materially heavier than V-Markt (images vs text). Treat as its own slice.

## Product direction (the "why" — locked)
- **Vision** (`docs/product/vision.md`): an *everyday savings / life-hacking companion*; groceries = proven pillar 1; future pillars (subscription/utility savings, price-drop tracking, budgeting, waste reduction) are illustrative bets, unvalidated. Extensibility constraint **C-7**: a new pillar = a new context module + ports/adapters, no rework of grocery code (don't build a speculative multi-pillar framework though).
- **product-overhaul reframe** (`docs/feature/product-overhaul/` + `docs/product/jobs.yaml`): primary job = **control grocery spend** (JOB-004); meal-planning is supporting; the **shopping list is the central artifact** (persisted selection). Slices: shopping-list core (done) → category filter + price sort → non-discounted add (done via manual add) → recipe inspiration from selection (not built).

## Known gotchas
- **Orphan `bun run src/server.ts` processes** pile up on :3000 across restarts, and background server tasks often exit 143/144 while a stale instance keeps serving. Before verifying: kill the pid on :3000 (`ss -ltnp | grep :3000`) and start fresh; confirm it serves the current code (grep a new marker).
- **SQLite WAL**: the server's writes sit in `discount-hunt.db-wal`; a fresh `sqlite3` CLI read of the main file may show 0 rows. Not a bug.
- **`bun run lint:arch` is broken** — `.dependency-cruiser.cjs` was never in the repo (not in `hook:push`). Ignore; the D34 rule (only `adapters/sqlite-*.ts` import `schema.ts`) is respected manually.
- A **stray `Bio-Hackfleisch` shopping_list row** exists from session DB churn — remove via the List UI if unwanted.
- Real DB dietary setting was left = **vegetarian** (matches persona) during testing.
