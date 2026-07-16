# HANDOFF — resume here (2026-07-17)

Read this first, then memory (`MEMORY.md` + `project_delivery_state.md`), `CLAUDE.md`, `docs/feature/discount-hunt/IDEAS.md`.

## ✅ Shipped this session (all committed, gates green: typecheck 0, 415 pass/4 skip/0 fail)
- **`629ea59` — product-details modal dialog + working images.** Name click opens a modal (image + brand + description + savings); offer link moved in-dialog (`target=_blank`); no-JS still links to the offer. New nullable fields `image_url`/`brand`/`description` threaded like `source_url`. Two image bugs fixed: (1) modal `<img>` was `loading="lazy"` + `hidden` → a lazy display:none image is never fetched → loader spun forever (all stores); now eager. (2) Aldi stored the raw ~11 MB `photoSharingUrl` → now uses `photoUrls[0].thumb` (~200px resize-proxy). Edeka image = marktguru CDN; V-Markt = 🛒 placeholder. Image is a fixed 220px `object-fit:contain` box + loading spinner + focus trap. Browser-verified desktop + 375px.
- **`f04384c` — IDEA-004** (categorise-before-swap / staged replace) added; offer-history bumped to **IDEA-005**.
- **`d0a2220` — stores entity + FKs + indexes (P1+P2+P5).** `stores(id,name,slug,created_at)` seeded from SSOT `src/shared/stores.ts`. `discount_items.store` + `scrape_jobs.store` (text) → `store_id` NOT NULL FK; text columns dropped. FK enforcement ON. Name-at-boundary: repos map name↔id via `src/shared/store-registry.ts`; domain/HTTP/client-filter stay name-based. Idempotent legacy migration in `createDb` (rebuild+backfill+drop, FK-off) — verified on temp + real DB. Indexes on hot paths. Soft refs (documented, no FK): `savings_log.plan_id`, `shopping_list_items.discount_item_id`, `discount_items.scrape_job_id`.

DB now (real): stores 3 · Aldi 32 (img 32) · EDEKA 201 (img 201) · V-Markt 109 (img 0) · 0 null store_id · 0 null taxonomy. Backup at `discount-hunt.db.bak-1784237622` (delete once satisfied).

## ⏭ Next (owner-agreed queue)
1. **P4 — category/tags cleanup (INVESTIGATE + report first).** `discount_items` has `category`(raw productType, NOT NULL) vs `taxonomy_category`(LLM bucket) AND `dietary_tags` vs `tags` (both classify vegan/vegetarian → overlap). Trace real UI usage, then propose a collapse or justify keeping both. No code until reported.
2. **P3 — single schema SSOT.** Kill the dual schema (raw `CREATE_*` in `db.ts` + Drizzle defs in `schema.ts`, hand-synced; ad-hoc `try/catch ALTER` migrations) → Drizzle-kit versioned migrations. Own bundle.
3. **IDEA-004 — staged replace** (keep old categorised discounts live until the new batch is categorised, then atomic swap; no "Other"-everything window).
4. **IDEA-005 — offer history + usage stats** (archive-on-replace).

## Commands
- Dev server (hot-reload): `bun run dev` → http://localhost:3000. Kill orphans first: `ss -ltnp | grep :3000` → `kill -9 <pid>`.
- Scrape all 3 + categorise (~4-5 min; V-Markt ~200s): `EDEKA_PLZ=80331 LLM_PROVIDER=claude-cli CLAUDE_CLI_MODEL=claude-haiku-4-5-20251001 bun run src/scraping/scraper-runner.ts`
- Categorise pending only: `LLM_PROVIDER=claude-cli CLAUDE_CLI_MODEL=claude-haiku-4-5-20251001 bun run src/categorisation/categoriser-runner.ts`
- Gates: `bun run typecheck` + `bun test`.

## Gotchas
- **Drizzle `db.get(sql\`…\`)` returns a POSITIONAL ARRAY** (`[2]`), not `{id:2}` — read `[0]`. (bun:sqlite `Database.query().all()` DOES return keyed objects — different API.) This bit us hard in the store refactor.
- Re-scrape clears `taxonomy_category` (rows replaced) → re-run categorisation after every scrape (IDEA-004 will fix the UX gap).
- Orphan `bun` on :3000 pile up; kill before browser-verify. WAL: fresh `sqlite3` CLI read may show 0 rows (use bun:sqlite). `lint:arch` broken (ignore). `curl`/`rtk curl` are permission-blocked — use `bun` fetch with `AbortSignal.timeout`.
- chrome-devtools `resize_page` stays mobile-locked → use `emulate` for desktop viewport.
- Do NOT push (push = production; many local commits ahead of origin, intentional).
- Subagents share the git user; they CAN accidentally commit — tell them "do NOT commit" and re-check `git log` after (one crafter committed a stray HANDOFF deletion this session).

## Open veto-list (autonomous decisions; owner may revisit)
- scrape_job_id / savings_log.plan_id / shopping_list.discount_item_id kept as SOFT refs (no FK) — see `d0a2220` rationale.
- Aldi image = 200px resize-proxy thumb; Aldi/V-Markt offer links = prospekt cover (not per-product); Edeka = exact offer.
- Edeka = advertiser `edeka` only; PLZ default 80331. V-Markt = weakest source (noisy, slow, no images).
- Store chip duplicates the store-group header (kept per earlier request).
