# HANDOFF — resume here (2026-07-17, DB-work sprint COMPLETE)

**The autonomous DB-work sprint (P4, IDEA-004, IDEA-005 Part A, P3) is DONE and committed to main (NOT pushed). One acceptance step is BLOCKED on your authorization; Part B is suggestions-only, written up, awaiting your approval.** Read this, then `MEMORY.md` + `project_delivery_state.md`, `CLAUDE.md`, `docs/feature/discount-hunt/IDEAS.md`.

## ✅ Shipped this session (committed to main, NOT pushed; gates green: typecheck 0, **425 pass / 4 skip / 0 fail**)
- `7299e46` **IDEA-004 categorise-before-insert** — `ScrapingService` classifies the normalized batch in memory (via injected `CategoryClassifier`, resolved from `resolveLlm()` in scraper-runner) BEFORE the atomic `replaceStore` swap, so inserted rows already carry `taxonomy_category` + `tags` — no "everything in Other" window. Graceful: classifier null / `classify()` throws / length-mismatch → insert NULL taxonomy, scrape never blocked; the NULL-only post-scrape hook heals later. `insertRow` now writes `tags`+`taxonomy_category` explicitly.
- `aa49ff7` **IDEA-005 Part A offer_history** — archive-on-replace. New `offer_history` table (surrogate `history_id` PK + `item_id`, mirrors discount_items + `archived_at` + `week_start` + `store_id` FK, indexed on store_id/item_id). `replaceStore` archives the store's live rows (`INSERT…SELECT`) as the first statement in its txn, before the DELETE (atomic; old rows' scrape_job_id/created_at preserved).
- `c1d4b76` **P3 single schema SSOT** — killed the dual schema. `src/shared/schema-ddl.ts` generates `CREATE TABLE` DDL (`generateCreateTableSql`) + schema-driven legacy column-heal (`generateMissingColumnAlters`) at runtime from the Drizzle defs via `getTableConfig`. Deleted all 9 raw `CREATE_*` strings + all 17 hand-listed `ALTER…ADD COLUMN` blocks from `db.ts`. NO drizzle-kit, NO migrations dir, NO populated-DB baselining (generated DDL is `IF NOT EXISTS` → no-op on the live DB). **HARD GATE passed both ways:** new `createDb` on a COPY of the real populated DB → `integrity_check` ok, `foreign_key_check` empty, all 342 items / 3 stores intact; `:memory:` suite green (migrate-from-scratch).

**P4 (category/tags cleanup) was already resolved last session: NO code change — all four classification columns are load-bearing & distinct (see prior handoff / commit history). Don't touch them.**

Working tree clean except untracked `.nwave/` (tooling, ignore) and `discount-hunt.db.bak-1784237622` (old backup — delete once satisfied). Real DB was NEVER mutated this session (all verification ran on `:memory:` or `/tmp` copies). DB state unchanged: stores 3 · Aldi 32 · EDEKA 201 · V-Markt 109 · offer_history 0 (table exists, empty until the first real re-scrape) · 0 null store_id/taxonomy.

---

## ⏭ OPEN ITEMS (next session)

### 1. BLOCKED — live-scrape + browser acceptance for IDEA-004 (needs YOUR authorization)
The owner's plan called for a re-scrape to confirm "no Other flash" in the browser. The autonomous run of the **live production scraper** (`bun run src/scraping/scraper-runner.ts`) was **denied by the auto-mode classifier** — it's a destructive production run (external fetches + LLM + replaces live rows) that "finish autonomously" didn't specifically authorize. Not worked around.
- **Done instead (non-destructive, real code path on a real-DB COPY):** drove `DiscountService.replaceStoreItems` with a classifier + fresh batch → new rows landed already-categorised (**0 NULL taxonomy** — 004 proven) AND the 32 prior Aldi offers archived to `offer_history` with `archived_at`/`week_start` (005A proven). Both features verified end-to-end short of a live fetch + screenshot.
- **To finish the visual confirmation:** authorize a real scrape (`! EDEKA_PLZ=80331 LLM_PROVIDER=claude-cli CLAUDE_CLI_MODEL=claude-haiku-4-5-20251001 bun run src/scraping/scraper-runner.ts`), then browser-check the feed shows categories immediately (kill orphan `bun` on :3000 first; chrome-devtools `emulate` for desktop). Or add a Bash permission rule if you want scrapes to run autonomously.

### 2. IDEA-005 Part B — SUGGESTIONS ONLY (owner to approve; DO NOT build yet)
Finalized in `docs/feature/discount-hunt/IDEAS.md` under IDEA-005 Part B (single source of truth — not duplicated here). TL;DR: B.1 derived-from-existing-data `/insights` read model (joins the now-shipped offer_history for "good deal vs usual") → B.2 events table → B.3/B.4 engagement + preference-driven UX. **Open questions for you are listed there** (events table wanted at all? privacy line? which personalization first?). No code until you approve.

---

## Architecture cheat-sheet (updated this session)
- **Stack:** Bun + bun:sqlite + drizzle-orm (bun-sqlite). Hexagonal (ports/adapters), OOP TS, strict (`noUncheckedIndexedAccess` + `exactOptionalPropertyTypes`). Server renders HTML strings (`src/shared/layout.ts`). Trunk-based, commit to main, NEVER push (push = prod).
- **Schema is now SINGLE SOURCE (P3 done):** `src/shared/schema.ts` (Drizzle defs) is the ONLY place table structure is declared. `src/shared/db.ts createDb()` builds every table + heals missing columns via the runtime generator in `src/shared/schema-ddl.ts` (`generateCreateTableSql` + `generateMissingColumnAlters`, both driven by `getTableConfig`). NO more raw `CREATE_*` strings or hand-listed ALTERs. To change the schema: edit `schema.ts` only. (The store→store_id legacy rebuild `migrateStoreToStoreId` still lives in db.ts for old dbs; the column-heal runs BEFORE it because the rebuild's SELECT reads the healed columns.)
- **Stores (name-at-boundary):** `src/shared/stores.ts` = canonical `STORES` SSOT. `src/shared/store-registry.ts` = `getOrCreateStoreId`/`findStoreId`. Repos map name↔id; domain/HTTP/client-filter/tests stay NAME-based. `getByWeek` JOINs stores.
- **Scrape flow (post-004/005A):** `scraper-runner.ts` → per store: fetcher → `CatalogueNormalizer` (adds `dietaryTags`) → `ScrapingService.run` **classifies the batch in memory (categorise-before-insert)** → `discountService.replaceStoreItems(store, items, jobId, classifications)` → `SQLiteDiscountItemRepository.replaceStore` (**archive live rows → offer_history**, delete WHERE store_id, insert already-categorised rows, all one txn) → post-scrape `runCategorisation` (NULL-only safety net, idempotent).
- **3 stores:** Aldi Süd (JSON API, exact prices, img `photoUrls[0].thumb`), EDEKA (marktguru API, advertiser `edeka` only, PLZ 80331, rarely oldPrice), V-Markt (pageflip HTML→LLM, slow ~200s, no images).
- **Categorisation:** LLM classifies EVERYTHING, chunked 25/call INSIDE `LlmCategoryClassifier` (per-chunk "Other" fallback — a hard failure throws out to 004's catch). `CategoryClassifier.classify({name,productType}[])→{category,tags}[]` is PURE/DB-free. LLM via `resolveLlm(env)` on `LLM_PROVIDER=claude-cli|openrouter`. claude-cli = local `claude -p` (free; drain stdout+stderr concurrently).

## Gotchas (don't relearn)
- **Live scraper is permission-gated** — running `scraper-runner.ts` against the real DB needs explicit user auth (classifier blocks autonomous production runs). Use `! <cmd>` or add a Bash rule.
- drizzle `db.get(sql\`…\`)` returns a POSITIONAL ARRAY (`[0]`), NOT `{id}`. bun:sqlite `Database.query().all()` returns KEYED objects. Different APIs.
- `SQLite ALTER TABLE ADD COLUMN` can't add PK/UNIQUE and can't add NOT-NULL-without-default to a populated table — `generateMissingColumnAlters` skips PK/unique; db.ts wraps each ALTER in try/catch (store_id's NOT-NULL ALTER on legacy tables is swallowed, then backfilled by migrateStoreToStoreId).
- `curl`/`rtk curl` are permission-blocked → use `bun -e` with `fetch(url,{signal:AbortSignal.timeout(...)})`.
- WAL: a fresh `sqlite3` CLI read may show 0 rows — read via bun:sqlite. `lint:arch` (dependency-cruiser) is broken — ignore.
- chrome-devtools `resize_page` stays mobile-locked → use `emulate` for desktop. Orphan `bun` on :3000 — `ss -ltnp | grep :3000` → `kill -9` before browser-verify.

## Commands
- Dev (hot-reload): `bun run dev` → http://localhost:3000.
- Scrape all 3 + categorise (~4-5 min; needs auth — see gotcha): `EDEKA_PLZ=80331 LLM_PROVIDER=claude-cli CLAUDE_CLI_MODEL=claude-haiku-4-5-20251001 bun run src/scraping/scraper-runner.ts`
- Categorise pending only: `LLM_PROVIDER=claude-cli CLAUDE_CLI_MODEL=claude-haiku-4-5-20251001 bun run src/categorisation/categoriser-runner.ts`
- Gates: `bun run typecheck` + `bun test` (429 tests, ~425 pass / 4 skip).

## Working rules (obey — learned across sessions)
- Commit each task the moment `bun run typecheck` (0) + `bun test` (0 fail) pass. Never batch. Re-check `git log` after every subagent (a crafter once made a stray commit). Tell delegated agents "do NOT commit".
- Scope subagent tasks small; give decision-complete specs. Verify user-visible changes in the browser.
- NEVER run `createDb`/scraper/migrations against the real `discount-hunt.db` during dev — createDb MUTATES its path. Use `:memory:` or `/tmp` copies; the HARD GATE for schema changes is a populated real-DB COPY (integrity_check + foreign_key_check + row counts), NOT a fresh temp DB.

## Open veto-list (autonomous calls; owner may revisit)
- scrape_job_id / savings_log.plan_id / shopping_list.discount_item_id kept as SOFT refs (no FK) — append-only or snapshot/event links.
- offer_history: `store_id` FK to stores(id); retention = keep all (tiny). `item_id` (not a FK) is the price-history join key across weeks.
- Aldi image = 200px thumb; Edeka = advertiser `edeka` only, PLZ 80331; V-Markt = weakest source (no images, rare regular price).
