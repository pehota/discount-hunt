# SPIKE-03 Decisions — discount-hunt (Store Scraping)

**Date**: 2026-07-14

## Assumption Tested

Can we fetch weekly discount items from Edeka and V-Markt Munich via plain HTTP (no headless browser)?

## Probe Verdict

**PARTIALLY WORKS**

- **V-Markt**: WORKS — plain HTTP (Apache/Pimcore, no bot protection). Slug discoverable by scraping `/angebote/muenchen`. Item data in flat `<p>` tags; discount price triplet pattern `X.XX - Y% Z.ZZ` (122 valid/week). Item names unreliable due to PDF-to-HTML layout flattening.
- **Edeka**: DOES NOT WORK — fully blocked by Akamai Bot Manager on all paths of `www.edeka.de`. No unprotected catalogue subdomain or Publitas path found. Playwright required.

## Promotion Decisions

### V-Markt — PROMOTE

**Rationale**: Plain HTTP, zero extra infrastructure, 122+ discount items/week. LLM-assisted extraction (Option B) chosen to resolve name-price association problem.

**V-Markt extraction strategy**: LLM-assisted (claude-haiku-4-5). Send each `<p>` block to Haiku for structured extraction. Cost: ~$0.001/weekly run. Resolves both name-price co-location ambiguity and price-ordering inconsistency between catalogue sections.

### Edeka — PIVOT (dropped)

**Rationale**: Playwright adds Chromium ~114 MB runtime dependency. Two Munich stores (Aldi Süd + V-Markt) via plain HTTP are sufficient for the use case. Edeka is deferred indefinitely.

**Known gap**: Edeka Munich weekly deals are not included. Mitigated by Aldi Süd (155 items/week) + V-Markt (122+ items/week) = ~277 items combined, covering adequate variety for 7-day meal planning.

## Walking Skeleton (Phase 3)

**Driving adapter**: `scraper-runner.ts` — runs Aldi Süd + V-Markt scrapers, discount_items table populated with store field, `GET /` renders items grouped by store

**Acceptance test**: `tests/acceptance/discount-hunt/walking-skeleton.test.ts` (extend existing) — or a new `multi-store.test.ts` scenario

**Demo command**: `CATALOGUE_SOURCE=fake bun run src/scraping/scraper-runner.ts && curl http://localhost:3000/`

## Design Implications for Slice-02

1. **Two scraper classes required**: `AldiSudCatalogueFetcher` (plain HTTP, Publitas/hotspots_data.json — scaffold already in place) + `VMarktCatalogueFetcher` (plain HTTP, pageflip HTML → LLM extraction).
2. **LLM extraction port**: `CatalogueExtractor` interface wrapping Haiku for V-Markt paragraph parsing. Faked in tests (fixture-based); real in production.
3. **Edeka excluded from Slice-02 scope** — dashboard has 2 store sections, not 3. Slice-02 acceptance criteria should be updated.
4. **V-Markt week starts Thursday** (vs Aldi Süd Monday). `valid_until` date arithmetic: slug DDMM + 6 days = Wednesday.
5. **Scrape schedule**: Run Monday 06:00 CET for both stores. V-Markt catalogue for the coming Thursday is already published by then.

## Constraints Discovered

- V-Markt: name-to-price association unreliable without LLM — regex-only extraction yields anonymous items
- V-Markt: ~8% of price triplets garbled (cross-product values from columnar PDF sections) — filter with `sale < regular AND |computed_pct - stated_pct| < 5%`
- Edeka: no plain HTTP path exists; any future Edeka integration requires Playwright runtime
- V-Markt week Thu–Wed vs Aldi Süd Mon–Sat: two different weekly cycles, both scraped on Monday
