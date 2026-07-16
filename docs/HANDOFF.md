# HANDOFF — resume here (2026-07-16)

Read this first, then `docs/PLAN.md`, memory (`MEMORY.md` + `project_delivery_state.md`), `CLAUDE.md`, `docs/feature/discount-hunt/IDEAS.md`.

## ⏳ RESUME POINT — Task 11: product-details dialog (BUILT, UNCOMMITTED, unverified)
The working tree has a complete, gates-green (`typecheck` 0, **418 tests pass / 4 skip / 0 fail**) but **uncommitted, unreviewed, not-browser-verified** feature: clicking a product name opens a **modal dialog** (image + details) instead of navigating; the offer link moved inside the dialog; no-JS still links to the offer.

**Uncommitted files** = the 21 listed by `git status` (schema/db/types + repo + normalizer + all 3 fetchers + discount-handler + layout + fixtures). New nullable fields `image_url`, `brand`, `description` threaded like `sourceUrl`. Aldi now keeps `photoSharingUrl` (was discarded); Edeka builds `cdn.marktguru.de/api/v1/offers/{id}/images/default/0/large.webp` when `images.count>0`; V-Markt = null.

**To finish Task 11 (do in order):**
1. `bun run typecheck` (0) + `bun test` (0 fail) — re-confirm.
2. Independent code review of the diff (feature-dev:code-reviewer) — fix valid findings.
3. **Clean full re-scrape** (also fixes the DB state below + populates the new columns):
   `EDEKA_PLZ=80331 LLM_PROVIDER=claude-cli CLAUDE_CLI_MODEL=claude-haiku-4-5-20251001 bun run src/scraping/scraper-runner.ts`
   (replace-per-store now active → V-Markt dupes self-heal. V-Markt leg is ~200s + noisy. Then verify all rows have image_url where expected.)
4. **Browser-verify** (kill orphan bun on :3000 first; `bun run dev`): name click → modal with image+details+savings%; V-Markt name → 🛒 placeholder (no image); "View original offer ↗" inside opens new tab; Esc + backdrop close; **0 h-overflow @375px AND desktop** (use the chrome `emulate` tool — `resize_page` stays mobile-locked). The subagent's checklist is in Task 11's completion message.
5. Commit (one bundle). Note in the message: this CHANGES the name-click from navigate→dialog (supersedes part of `a89b2fd`); offer link now surfaced in-dialog.

## DB state (needs the clean re-scrape in step 3)
`Aldi 32 · EDEKA 201 · V-Markt 167(has dupes) · image_url populated: 0`. The re-scrape (replace-per-store) resets V-Markt cleanly and fills image_url/brand/description for Aldi+Edeka (V-Markt stays null). Then run categorisation (it runs post-scrape when `LLM_PROVIDER` is set; else `bun run src/categorisation/categoriser-runner.ts` with `LLM_PROVIDER=claude-cli`).

## Then: IDEA-004 (queued next, in IDEAS.md) — offer history + usage statistics
Owner-requested, AFTER the dialog. Offer-history table (archive rows in `replaceStore`'s txn BEFORE delete) + a phased usage-stats design. Full design in `docs/feature/discount-hunt/IDEAS.md`.

## Commands
- Dev server (hot-reload): `bun run dev` → http://localhost:3000. Kill orphans first: `ss -ltnp | grep :3000` → `kill -9 <pid>`.
- Scrape all 3 stores + categorise: `EDEKA_PLZ=80331 LLM_PROVIDER=claude-cli CLAUDE_CLI_MODEL=claude-haiku-4-5-20251001 bun run src/scraping/scraper-runner.ts` (~4-5 min; V-Markt ~200s). Fast Aldi+Edeka only: omit `LLM_PROVIDER` (V-Markt skips, no categorisation) then categorise separately.
- Categorise pending: `LLM_PROVIDER=claude-cli CLAUDE_CLI_MODEL=claude-haiku-4-5-20251001 bun run src/categorisation/categoriser-runner.ts`
- Gates: `bun run typecheck` + `bun test`.

## Architecture (this session's arc — see project_delivery_state.md memory for detail)
- **3 stores**: Aldi Süd (JSON API, exact prices+images), V-Markt (pageflip HTML→LLM text extract; noisy/slow/**no images/no regular price often**; random-id dup bug FIXED via stable hash + replace-per-store), EDEKA (marktguru public JSON API — structured, no vision, no bot-bypass; `edeka` advertiser only; images via CDN; **rarely has oldPrice** → mostly sale-price-only).
- **LLM layer** (`src/llm/`): `LlmTextGenerator` port + `resolveLlm(env)` switch on `LLM_PROVIDER=claude-cli|openrouter` (no fallback). claude-cli = local `claude -p` (free; MUST drain stdout+stderr concurrently — deadlock fix). Used by V-Markt extraction + categorisation.
- **Categorisation**: LLM-classifies-EVERYTHING (rules removed), chunked 25/call, idempotent (NULL only); `TaxonomyCategory` 8 buckets (**no "Frozen"** — food-type not temperature); **Frozen/Organic/Vegan/Vegetarian/Alcoholic are cross-cutting `tags`** (searchable + chips).
- **discount_items** now carries: category, taxonomy_category, tags(JSON), dietary_tags(JSON), source_url, +(uncommitted) image_url/brand/description.
- **replace-per-store**: `SQLiteDiscountItemRepository.replaceStore` DELETEs a store's rows + INSERTs the batch in one txn, AFTER successful fetch+normalize; empty-normalize SKIPS (won't wipe). Shared `insertRow`.

## Gotchas
- Orphan `bun` on :3000 pile up; kill before browser-verify. WAL: fresh `sqlite3` CLI read may show 0 rows (use bun:sqlite). `lint:arch` broken (ignore).
- Re-scrape clears `taxonomy_category` (replace reassigns rows) → re-run categorisation after every scrape. Re-scrape can dangle an already-generated meal plan's item refs (graceful).
- chrome-devtools `resize_page` stays mobile-locked → use `emulate` tool for desktop viewport.
- Do NOT push (push = production = outward; ~30 commits ahead of origin, all local, intentional).

## Open veto-list (decisions made autonomously; user may want to change)
- Store chip duplicates the store-group section header (kept per explicit request).
- Aldi/V-Markt offer links = prospekt cover (not per-product); Edeka = exact offer.
- Edeka = advertiser `edeka` only (not E center/E xpress); PLZ default 80331.
- Detail fields stored = image_url/brand/description only (unit/referencePrice/quantity available but deferred, KISS).
- V-Markt is the weakest source (noisy, slow, no images, rare regular price) — acceptable per owner.
