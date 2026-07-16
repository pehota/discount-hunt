# HANDOFF — resume here (2026-07-17)

**You are resuming an autonomous DB-work sprint. Work end-to-end, commit each task the instant it's green, don't rediscover what's already mapped below.** Read this, then `MEMORY.md` + `project_delivery_state.md`, `CLAUDE.md`, `docs/feature/discount-hunt/IDEAS.md`.

Owner directives for this sprint: implement **P4, IDEA-004, IDEA-005 Part A, P3** autonomously; **IDEA-005 Part B = SUGGESTIONS ONLY (do NOT implement), and it comes LAST**. Then update this handoff.

## Working rules (learned this session — obey them)
- **Commit each task the moment `bun run typecheck` (0) + `bun test` (0 fail) pass. Never batch.** Two subagents stream-timed-out mid-work this session; small committed increments survived, big uncommitted ones didn't.
- **After every subagent, re-check `git log`** — one crafter made a stray unauthorized commit (deleted HANDOFF.md). Tell delegated agents "do NOT commit".
- Scope subagent tasks small; give decision-complete specs.
- Verify in the browser for anything user-visible (chrome-devtools `emulate` for desktop; `resize_page` is mobile-locked). Kill orphan `bun` on :3000 first (`ss -ltnp | grep :3000` → `kill -9`).

## ✅ Shipped this session (committed to main, NOT pushed; gates green: typecheck 0, 415 pass/4 skip/0 fail)
- `629ea59` product-details modal dialog + working images (lazy→eager fix; Aldi 11 MB→200px thumb; 220px `object-fit:contain` box + spinner + focus trap).
- `f04384c` IDEA-004 captured, offer-history renumbered to IDEA-005.
- `d0a2220` **stores entity + FKs + indexes** (P1+P2+P5): `stores(id,name,slug,created_at)` seeded from SSOT `src/shared/stores.ts`; `discount_items.store`/`scrape_jobs.store` → `store_id` NOT NULL FK (text dropped); FK enforcement ON; name-at-boundary via `src/shared/store-registry.ts`; idempotent legacy rebuild in `createDb`. Soft refs (no FK, documented): scrape_job_id, savings_log.plan_id, shopping_list.discount_item_id.
- `d863796` restored+updated this HANDOFF.

Working tree is clean except untracked `.nwave/` (tooling, ignore) and `discount-hunt.db.bak-1784237622` (DB backup — delete once satisfied). DB now: stores 3 · Aldi 32 (img 32) · EDEKA 201 (img 201) · V-Markt 109 (img 0) · 0 null store_id/taxonomy.

---

## TASK QUEUE (do in this order)

### ✅ P4 — category/tags cleanup: DONE (investigation, NO code change)
Verdict: **all four classification columns are load-bearing and distinct — NO safe collapse.** Don't touch them.
- `discount_items.category` = raw German productType (e.g. "Gemüse - Tomaten"). NOT user-facing. Used as: LLM classifier INPUT (repo `findUncategorised` surfaces it as `productType`), and the source for `classifyDietaryTags()` at scrape time. (Repo comment at `sqlite-discount-item-repository.ts:166` documents the name remap: DB `category` → port field `productType`.)
- `taxonomy_category` = LLM food-type bucket (`TaxonomyCategory`, 8 buckets). Drives feed grouping/filter + shopping-list category headers (`shopping-list-handler.ts:104` groups by `item.taxonomyCategory`).
- `dietary_tags` = `DietaryTag[]` = `vegetarian|vegan|contains-meat|contains-fish|unknown`. Feeds the dietary FILTER via `isCompatible()` (`src/shared/dietary.ts`). Carries NEGATIVE info (contains-meat/contains-fish) used to exclude items.
- `tags` = `Tag[]` = `Frozen|Organic|Vegan|Vegetarian|Alcoholic` = LLM cross-cutting display/search chips.
- **The overlap (vegan/vegetarian in BOTH `dietary_tags` and `tags`) is real but NOT safely collapsible**: `tags` lacks the `contains-meat`/`contains-fish`/`unknown` negatives that `isCompatible` needs. Collapsing would mean rewiring `isCompatible` to derive meat/fish from another source — a dietary-filter-correctness risk. **Recommendation (future, only with the owner + tests): if unifying, make `dietary_tags` derivable and keep `isCompatible` semantics intact; not worth the risk now.** No commit for P4.

### ⏭ IDEA-004 — staged replace (categorise before swap) — NEXT, IMPLEMENT
**Goal:** never show the "everything in Other" window that happens today (replaceStore swaps live rows immediately, categorisation fills NULLs afterward).

**CHOSEN DESIGN — categorise-before-insert (simpler than a staging table; no read-path leakage):**
The classifier is already **pure + DB-independent**:
`CategoryClassifier.classify(items: {name, productType}[]) → {category: TaxonomyCategory, tags: Tag[]}[]` (`src/categorisation/ports.ts`). Today `CategorisationService.run()` reads `findUncategorised()` from the DB, calls `classify(...)`, writes back `setCategorisation()`. But `classify()` itself needs no DB.

So: in the scrape pipeline, **categorise the normalized batch in memory BEFORE `replaceStore` inserts it**, so the atomic swap only ever writes already-categorised rows.
- Thread `taxonomyCategory` + `tags` onto the items being inserted (extend `NormalizedItem`, or pass a parallel classified array into `replaceStore`/`insertRow`). `insertRow` currently writes `tags` default `'[]'` and `taxonomy_category` NULL — set them from the classification instead.
- Pipeline per store (`src/scraping/scraper-runner.ts` around the `replaceStoreItems` call at the store loop; `scraping-service.ts:run()` calls `discountService.replaceStoreItems`): fetch → normalize → **classify (LLM) the normalized batch** → `replaceStore` inserts categorised rows.
- **Graceful:** if classification throws OR no LLM is configured (`resolveLlm()` null), fall back to today's behaviour (insert with NULL taxonomy; the post-scrape `runCategorisation` still catches up) — never block a scrape on the LLM. Do NOT skip the swap on LLM-absence; only skip categorisation. (Re-read the idea: "keep old live until new is categorised" — with categorise-before-insert, "new is categorised" happens in-memory pre-swap, so the swap is inherently atomic+categorised when the LLM is present.)
- The post-scrape `runCategorisation(buildCategoriseDeps())` hook (`scraper-runner.ts:231`) stays as the NULL-only safety net (idempotent).
- **Why not a staging table / pending flag:** a pending flag leaks into every read path (feed, `findUncategorised`, shopping-list) unless all filter it; a staging table duplicates schema+FKs. Categorise-before-insert avoids both. (If you diverge to a staging table, audit ALL readers.)
- **Tests:** unit-test the pipeline with a `FakeClassifier` — assert items land with taxonomy+tags set at insert (no NULL window); assert LLM-throws → items still inserted (graceful) + post-hook catches up. Reuse existing scraping-service/scraper-runner test seams.
- Commit alone. Then re-scrape to confirm no "Other" flash (browser).

### ⏭ IDEA-005 Part A — offer_history (archive-on-replace) — IMPLEMENT after 004
- New table `offer_history`: all `discount_items` columns + `archived_at` (ms) + keep `scrape_job_id` + add `week_start` (from `valid_until` or scrape time) for convenience. Since `discount_items` now uses `store_id`, `offer_history` should carry `store_id` too (FK → stores(id), or store_id INT — keep it queryable by store).
- In `replaceStore`'s transaction, **BEFORE the delete**: `INSERT INTO offer_history (…, archived_at, …) SELECT …, <now>, … FROM discount_items WHERE store_id = ?`. Then delete + insert fresh (all one txn — archive+replace atomic). With IDEA-004 done, this archive sits at the same swap point.
- Add the table to BOTH `db.ts` raw DDL (`CREATE_OFFER_HISTORY`, created after discount_items) AND `schema.ts` Drizzle def (until P3 unifies them). No FK enforcement worries: offer_history references stores(id) (exists) — fine.
- Retention: keep all (tiny). Index `offer_history(store_id)`, maybe `(id)` for price-history-per-product.
- **Tests:** replaceStore twice for a store → offer_history has the first batch's rows with archived_at set; live table has only the second batch.
- Commit alone.

### ⏭ P3 — single schema SSOT — IMPLEMENT LAST of the code tasks, GATED
Kill the dual schema (raw `CREATE_*` strings in `db.ts` + Drizzle defs in `schema.ts`, hand-synced) + the ~10 ad-hoc `try/catch ALTER` migrations → one source.
- **Preferred:** drizzle-kit generate + `migrate()` in `createDb`. The tricky part is **baselining the EXISTING populated real DB** (generated migrations use bare `CREATE TABLE`, which fails on existing tables). Strategy: generate a baseline migration = full current schema; for an existing DB, seed `__drizzle_migrations` so the baseline is marked applied (don't run it); fresh DBs run all.
- **HARD GATE (advisor):** P3 ships ONLY if BOTH pass: (1) `cp discount-hunt.db /tmp/p3test.db` → run startup/`createDb` against the copy → clean, data intact; (2) `:memory:` tests still pass (migrate-from-scratch path). A fresh-temp-DB pass is NOT sufficient — the baseline failure only shows on a populated DB.
- **If drizzle-kit is fragile on the real DB, DON'T force it.** Lighter SSOT that still satisfies intent: a startup assert that the raw DDL matches the Drizzle schema (or a single generator feeding both). Or **defer P3 entirely and make it the top item of the next handoff** — everything valuable is already committed, so bailing is cheap.
- Commit alone (or defer).

### 🔚 IDEA-005 Part B — SUGGESTIONS ONLY, do NOT implement (owner directive), LAST
Write suggestions into IDEAS.md / this handoff; no code. See "Part B suggestions" below.

---

## Part B suggestions (usage statistics — for the owner to approve; DO NOT build yet)
Single-user, local (SQLite), no third-party. Phased (cheapest/highest-value first):
- **B.1 Derived-from-existing-data (no new tracking):** an `/insights` (or Settings tab) read-only summary computed on the fly from what's already stored — shopping_list composition by store/category/tag (reveals real preferences), manual-vs-discount add ratio, list-size distribution, meal-plan frequency, realized savings over time (savings_log), current dietary/budget settings. **Suggestion:** ship this FIRST — pure read model, zero new schema, immediately useful; keep it a compact summary, not a dashboard. Combine with **offer-history (Part A)** to answer "is this a good deal vs its usual price?" and "cheapest ever".
- **B.2 Interaction events (new lightweight tracking):** `events(type, payload JSON, week_start, ts)` table + `POST /events` + tiny client beacons on store/category filter, search terms, dialog opens, "view original offer" clicks, add-to-list. Lets you separate *interest* (dialog/filter) from *action* (add) → find high-interest-low-conversion categories. **Suggestion:** only after B.1 proves the insights are worth acting on; keep beacons fire-and-forget, no PII, one table.
- **B.3 Engagement/patterns:** visits, active days/times, feature usage, scrape-freshness vs visit timing. Builds on B.2's event stream.
- **B.4 Insights view + preference-driven UX:** dashboard over A+B, then ACT on inferred preferences — personalize feed defaults (default store/category to favourites), surface preferred categories first, "good deal" badges powered by offer-history price stats.
- **Build order:** A + B.1 → B.2 → B.3/B.4. **Open questions for owner:** is an events table wanted at all (vs. staying purely derived)? Any privacy line even for a local single-user tool? Which one personalization is most wanted first (default filters vs. good-deal badges)?

---

## Architecture cheat-sheet (so you don't rediscover)
- **Stack:** Bun + bun:sqlite + drizzle-orm (bun-sqlite). Hexagonal (ports/adapters), OOP TS, strict (`noUncheckedIndexedAccess` + `exactOptionalPropertyTypes`). Server renders HTML strings (`src/shared/layout.ts` = inline-CSS shell; handlers build pages). Trunk-based, commit to main, NEVER push (push = prod).
- **Schema lives in TWO places (P3 will fix):** raw `CREATE_*` DDL + idempotent `try/catch ALTER` in `src/shared/db.ts createDb()`, AND Drizzle table defs in `src/shared/schema.ts`. Keep both in sync until P3.
- **Stores (name-at-boundary):** `src/shared/stores.ts` = canonical `STORES` [{name,slug}] SSOT. `src/shared/store-registry.ts` = `getOrCreateStoreId(db,name)` / `findStoreId(db,name)` (slug-collision-safe). Repos map name↔id; domain types, HTTP rendering, client store-filter, and tests all stay NAME-based. `getByWeek` JOINs stores to expose `stores.name`.
- **Scrape flow:** `scraper-runner.ts` (CLI) → per store: fetcher → `CatalogueNormalizer` (adds `dietaryTags` via keyword `classifyDietaryTags`) → `scraping-service.run(store)` → `discountService.replaceStoreItems` → `SQLiteDiscountItemRepository.replaceStore` (delete WHERE store_id + insert, one txn) → post-scrape `runCategorisation` (NULL-only, idempotent).
- **3 stores:** Aldi Süd (JSON API, exact prices, image = `photoUrls[0].thumb` ~200px), EDEKA (marktguru public API, advertiser `edeka` only, PLZ 80331, rarely has oldPrice, image via marktguru CDN), V-Markt (pageflip HTML→LLM extract; slow ~200s, noisy, no images, rare regular price).
- **Categorisation:** LLM classifies EVERYTHING (rules removed), chunked 25/call, idempotent (NULL only). `CategoryClassifier.classify({name,productType}[])→{category,tags}[]` is PURE/DB-free (key for IDEA-004). LLM via `resolveLlm(env)` switch on `LLM_PROVIDER=claude-cli|openrouter` (no fallback). claude-cli = local `claude -p` (free; drain stdout+stderr concurrently or it deadlocks).

## Gotchas (cost real time — don't relearn)
- **drizzle `db.get(sql`…`)` returns a POSITIONAL ARRAY** (`[2]`), NOT `{id:2}` → read `[0]`. But bun:sqlite `Database.query(...).all()` returns KEYED objects (`{name}`). Different APIs — the migration code uses the latter, the store-registry uses the former.
- Re-scrape clears `taxonomy_category` (rows replaced) → post-scrape categorisation must run (IDEA-004 fixes the visible gap).
- `curl` / `rtk curl` are permission-blocked. To hit a URL, use `bun -e` with `fetch(url,{signal:AbortSignal.timeout(12000)})`.
- WAL: a fresh `sqlite3` CLI read may show 0 rows — read via bun:sqlite. `lint:arch` (dependency-cruiser) is broken — ignore.
- chrome-devtools `resize_page` stays mobile-locked → use `emulate` for desktop.
- Orphan `bun` on :3000 accumulate — kill before browser-verify.

## Commands
- Dev (hot-reload): `bun run dev` → http://localhost:3000.
- Scrape all 3 + categorise (~4-5 min; V-Markt ~200s): `EDEKA_PLZ=80331 LLM_PROVIDER=claude-cli CLAUDE_CLI_MODEL=claude-haiku-4-5-20251001 bun run src/scraping/scraper-runner.ts`
- Categorise pending only: `LLM_PROVIDER=claude-cli CLAUDE_CLI_MODEL=claude-haiku-4-5-20251001 bun run src/categorisation/categoriser-runner.ts`
- Gates: `bun run typecheck` + `bun test`. (419 tests, ~415 pass/4 skip.)

## Open veto-list (autonomous calls; owner may revisit)
- scrape_job_id / savings_log.plan_id / shopping_list.discount_item_id kept as SOFT refs (no FK) — `d0a2220` rationale (append-only or snapshot/event links; hard FKs fight delete-reinsert / weekly-regen).
- Aldi image = 200px resize-proxy thumb; offer links: Aldi/V-Markt = prospekt cover, Edeka = per-offer. Edeka = advertiser `edeka` only, PLZ 80331. V-Markt = weakest source.
- Store chip duplicates the store-group header (kept per earlier request).
