# Evolution: discount-hunt DELIVER Wave

**Date**: 2026-07-14
**Iteration**: S01 + S02 (of 5 planned)
**Status**: COMPLETE — all 12 steps DONE, acceptance suite GREEN (66 pass, 4 skip, 0 fail)

---

## Feature Summary

**Primary job**: When planning weekly groceries with no knowledge of current promotions, Dimitar wants to generate a discount-first 7-day meal plan filtered to his dietary restrictions, so he can cook real meals while spending meaningfully less than unplanned shopping.

Two delivery slices shipped in this DELIVER wave:

- **S01 (Walking Skeleton)**: Single-store Aldi Süd scraper, SQLite persistence, discount feed at `GET /`, meal plan generation via `POST /plan/generate` + `GET /plan`, savings log, dietary filtering scaffold.
- **S02 (Multi-store + Staleness)**: V-Markt integration (Haiku AI-powered PDF extraction), staleness warnings (48h threshold), per-store empty-state UI, meal plan format upgrade (14 slots: 7 days × 2), prior-week filter fix, schema migration guard (meals column idempotency).

**Architecture**: OOP TypeScript, Bun runtime, SQLite + Drizzle ORM, Bun HTTP server, OS cron for weekly scrape.

**North-star hypothesis**: Cumulative monthly savings ≥ €20 after 4 weeks of use.

---

## Business Context

Single-user personal tool. Dimitar Apostolov, software engineer, vegetarian, Munich. Three jobs validated:

| Job | Opportunity Score | Coverage at Close |
|-----|------------------|-------------------|
| JOB-001: Weekly grocery planning driven by discounts | 9 | DELIVERED — 2-store discount feed, 14-slot meal plan |
| JOB-002: Track actual grocery savings vs full price | 8 | DELIVERED — savings log + D23 atomic write |
| JOB-003: Ensure meal plan respects dietary restrictions | 9 | DEFERRED — S03 (filter scaffold in place, tag engine placeholder) |

**Baseline**: 30-45 min/week manual browsing → <2 min via the app (to be measured at 4-week check).

---

## Work Completed (Execution Log)

### S01 — Walking Skeleton

| Step | Name | Result | Date |
|------|------|--------|------|
| 01-01 | Shared foundation: schema, db, dietary, types | PASS | 2026-07-13 |
| 01-02 | Scraping pipeline and discount registration | PASS | 2026-07-13 |
| 01-03 | Discount HTTP feed: GET / | PASS | 2026-07-14 |
| 01-04 | Plan generation and savings tracking (D23 atomic) | PASS | 2026-07-14 |
| 01-05 | Server composition root (D35 wire order) | PASS | 2026-07-14 |

### S02 — Multi-store, Staleness, 7-Day Plan

| Step | Name | Result | Date |
|------|------|--------|------|
| 02-01 | Real AldiSudCatalogueFetcher | PASS | 2026-07-14 |
| 02-02 | CatalogueExtractor port + HaikuCatalogueExtractor + VMarktCatalogueFetcher | PASS | 2026-07-14 |
| 02-03 | Live scraper wiring in scraper-runner.ts | PASS | 2026-07-14 |
| 02-04 | 7-day meal plan generation (14 slots) | PASS | 2026-07-14 |
| 02-05 | Staleness warning + per-store empty-state UI | PASS | 2026-07-14 |
| 02-06 | Post-verification: week filter + DB migration guard | PASS | 2026-07-14 |
| 02-07 | Regression ATs: prior-week filter + schema migration boot | PASS | 2026-07-14 |

**Tests at close**: 66 pass, 4 skip (@skip scenarios deferred to later slices), 0 fail.

---

## Demo Evidence

**Discount feed (GET /)**
- Status 200; items grouped per store (Aldi Süd, V-Markt); both prices rendered; staleness banner when store last scraped >48h ago; per-store empty-state when 0 items this week.

**Meal plan (POST /plan/generate → GET /plan)**
- POST 303/200; plan renders 14 slots (7 days × lunch + dinner); items cycled when fewer than 14 available; placeholder for 0-item week.

**Savings tracker (GET /savings)**
- D23 invariant confirmed: `data-saved-amount` == `data-estimated-savings` (written in same SQLite transaction).

**Regression gates (S02 close)**
- Prior-week items (validUntil < weekStart) absent from `GET /`; current-week items present.
- DB opened without meals column starts cleanly via try/catch ALTER TABLE guard.

---

## Key Decisions

### DISCUSS Wave (D1–D10)

| ID | Decision |
|----|----------|
| D1 | JTBD analysis — all stories trace to jobs.yaml |
| D3 | Walking skeleton = SLICE-01: one store, one discount, one meal, one saving |
| D5 | Elephant Carpaccio slicing: ≤1 day per slice |
| D6 | Aldi Süd: plain HTTP; prospekt.aldi-sued.de serves static JSON — SPIKE-01 validated |
| D7 | Recipe source: Brave Search API → top result → schema.org/Recipe JSON-LD — deferred to S05 |
| D8 | regular_price captured at scrape time; MUST persist beyond promotion end |
| D9 | Single-user; no auth, no multi-tenancy |

### DESIGN Wave (D11–D37)

| ID | Decision |
|----|----------|
| D11 | Modular monolith — one Bun HTTP process |
| D13 | SQLite WAL mode — 4 MB/year, single writer |
| D17 | Bun TypeScript runtime (validated in SPIKE) |
| D22 | regular_price: write-once invariant at scrape time; no UPDATE ever |
| D23 | estimated_savings and savings_log.saved_amount written in same SQLite transaction |
| D26 | Context boundaries: logical module boundaries (src/{context}/); no cross-context imports except Shared Kernel |
| D29 | HTTP server: Bun.serve built-in |
| D30 | Drizzle ORM + Drizzle Kit (type-safe schema, versioned migrations) |
| D31 | Server-rendered HTML + HTMX (no build step, no JS framework) |
| D33 | isCompatible() as Shared Kernel in src/shared/dietary.ts — single dietary predicate |
| D34 | dependency-cruiser: pre-commit + CI architectural linting |
| D35 | Composition root wire order: createDb → services → probe → routes |
| D37 | generatePlan() pure computation (value); savePlan() only impure function (D23 transaction) |

### Spike-03 Decisions (Store Scraping — S02)

| Decision | Outcome |
|----------|---------|
| V-Markt scraping | PROMOTED — plain HTTP, zero extra infrastructure, 122+ items/week |
| V-Markt extraction strategy | LLM-assisted (claude-haiku-4-5): send `<p>` blocks for structured extraction; cost ~$0.001/weekly run |
| Edeka | DROPPED — fully blocked by Akamai Bot Manager; Playwright required; two Munich stores sufficient |
| CatalogueExtractor port | Defined as interface; HaikuCatalogueExtractor is production impl; FakeCatalogueExtractor for tests |

---

## Issues Encountered and Resolution

| ID | Issue | Resolution |
|----|-------|------------|
| I1 | XSS — item names unescaped in HTML output | Open — deferred to S03 |
| I2 | No HTTP error boundary on plan generation | Open — deferred to S03 |
| I3 | Zero-assertion test in db.test.ts | Fixed in S01 (commit 046674d) |
| I4 | D23 atomicity — failure-injection test missing | Open — deferred to S03 |
| I5 | getByWeek() full table scan ignoring weekStart | Fixed in 02-06 — added WHERE valid_until >= weekStart |
| I6 | createDb() CREATE TABLE not idempotent for new columns on existing DBs | Fixed in 02-06 — try/catch ALTER TABLE meals column guard |
| I7 | 02-07 committed in two passes (test-file created, then confirmed GREEN separately) | No action — log reflects correct PASS state |

---

## Lessons Learned

1. **Fake injection via env vars works cleanly for CLI subprocesses.** `CATALOGUE_SOURCE=fake` + `FAKE_CATALOGUE_FIXTURE` path allows acceptance tests to own fixtures without mocking the subprocess boundary. No subprocess-mocking framework needed.

2. **Both-price filter at ACL boundary eliminates a class of savings calculation bugs.** CatalogueNormalizer drops items missing either `price` or `discountedPrice` before they reach the domain layer. The Savings Tracker never sees items it cannot compute savings for.

3. **Same-transaction write (D23) made consistency testing trivial.** Testing the D23 invariant was a single HTML attribute comparison (`data-estimated-savings == data-saved-amount`), not an async reconciliation.

4. **SPIKE-01 saved significant time.** Validating the Aldi Süd catalogue endpoint (plain HTTP, static JSON, HEAD→302 slug) before DESIGN meant the scraper architecture was committed without a live-network risk.

5. **LLM extraction (Haiku) resolved the V-Markt name-price association problem cleanly.** Regex-only extraction from PDF-to-HTML produces anonymous items due to columnar layout flattening. Haiku at ~$0.001/weekly run adds negligible cost while providing reliable structured output.

6. **Port abstraction (CatalogueExtractor interface) paid off immediately.** Injecting FakeCatalogueExtractor in unit tests meant zero Anthropic API calls in the test suite. The real HaikuCatalogueExtractor is isolated to production run only.

7. **Week-filter bug caught by post-verification, not initial ATs.** `getByWeek()` was doing a full table scan; prior-week items were surfacing in the feed. Adding regression ATs (02-07) confirmed both the bug and the fix, and provides a guard against recurrence.

8. **Schema migration guard pattern (try/catch ALTER TABLE) is pragmatic for single-user SQLite.** No migration framework needed at this scale; the idempotent column-add pattern is a standard SQLite technique and adequate for the delivery cadence.

---

## Open Questions Carried Forward

| ID | Question | Target Slice |
|----|----------|-------------|
| OQ-1 | Brave Search API key validation | S05 |
| OQ-4 | Dietary keyword classifier coverage | S03 |
| OQ-5 | Docker overlayfs SQLite fsync risk | Platform / DEVOPS wave |

*OQ-2 (V-Markt scraping feasibility) and OQ-3 (store codes) resolved in SPIKE-03 and S02.*

---

## KPI Baselines

Formal measurement begins at 4-week mark (weekly use). Baselines captured at DELIVER close:

| KPI | Baseline | Target | Measurement |
|-----|----------|--------|-------------|
| Grocery browsing time | 30-45 min/week (manual) | < 2 min | Self-reported at 4-week check |
| Weekly plan adoption | 0 weeks/month | ≥3 weeks/month | meal_plans table row count |
| Monthly savings | €0 tracked | ≥€20/month after 4 weeks | savings_log cumulative total |
| Dietary violations | N/A (manual review) | 0/week | Self-reported |

---

## Migration Notes (Phase B)

No migration performed. All lasting artifacts were written directly to permanent locations during active waves:

- Architecture + ADRs: `docs/product/architecture/` (brief.md, adr-001 through adr-005) — permanent
- UX journey: `docs/product/journeys/weekly-discount-meal-planning.yaml` — permanent
- Persona: `docs/product/personas/dimitar.yaml` — permanent
- Jobs: `docs/product/jobs.yaml` — permanent
- ATDD policy: `docs/architecture/atdd-infrastructure-policy.md` — permanent
- Spike findings: `docs/feature/discount-hunt/spike/` — retained in feature workspace

The `docs/feature/discount-hunt/` workspace directory is preserved intact (wave matrix depends on it).

No design/, distill/, or discuss/journey-*.yaml files exist (lean v3.14 format) — destination-map entries in the standard migration table are all N/A.

---

## Permanent Artifact Links

| Artifact | Location |
|----------|----------|
| Architecture SSOT | `docs/product/architecture/brief.md` |
| ADR-001: Process topology | `docs/product/architecture/adr-001-process-topology.md` |
| ADR-002: Database | `docs/product/architecture/adr-002-database.md` |
| ADR-003: Bounded contexts | `docs/product/architecture/adr-003-bounded-contexts.md` |
| ADR-004: Tech stack | `docs/product/architecture/adr-004-tech-stack.md` |
| ADR-005: Dietary filter enforcement | `docs/product/architecture/adr-005-dietary-filter-enforcement.md` |
| ATDD policy | `docs/architecture/atdd-infrastructure-policy.md` |
| Walking skeleton acceptance test | `tests/acceptance/discount-hunt/walking-skeleton.test.ts` |
| Multi-store acceptance test | `tests/acceptance/discount-hunt/multi-store.test.ts` |
| Feature workspace | `docs/feature/discount-hunt/` |
| Slice plans | `docs/feature/discount-hunt/slices/` |
| Spike findings | `docs/feature/discount-hunt/spike/` |
| Feature delta (lean v3.14) | `docs/feature/discount-hunt/feature-delta.md` |

---

## Next Iteration

**S03**: Dietary filter — full restriction enum, isCompatible() applied in getByWeek, settings UI.
- Learning hypothesis: Does filtering by dietary restriction meaningfully reduce plan violations?
- Hardening also due: I1 (XSS), I2 (HTTP error boundary), I4 (D23 failure-injection test)

**S04**: Savings history — historical list + month-to-date aggregation.

**S05**: Recipe integration — Brave Search API + Chefkoch JSON-LD parser.
