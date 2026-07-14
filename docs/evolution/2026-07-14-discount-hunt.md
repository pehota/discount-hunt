# Evolution: discount-hunt S01 Walking Skeleton

**Date**: 2026-07-14
**Iteration**: S01 (of 5)
**Status**: COMPLETE — all 5 steps DONE, acceptance suite GREEN

---

## Feature Summary

**Primary job**: When planning weekly groceries with no knowledge of current promotions, Dimitar wants to generate a discount-first 7-day meal plan filtered to his dietary restrictions, so he can cook real meals while spending meaningfully less than unplanned shopping.

S01 delivers the walking skeleton: one store (Aldi Süd) → one discounted item → one-meal plan → savings amount confirmed. All 4 bounded contexts are exercised end-to-end. Future slices (S02–S05) add breadth without changing the pipeline shape.

**North-star hypothesis**: Cumulative monthly savings ≥ €20 after 4 weeks of use.

---

## Business Context

Single-user personal tool. Dimitar Apostolov, software engineer, vegetarian, Munich. Three jobs validated:

| Job | Opportunity Score | S01 Coverage |
|-----|------------------|--------------|
| JOB-001: Weekly grocery planning driven by discounts | 9 | DELIVERED (walking skeleton) |
| JOB-002: Track actual grocery savings vs full price | 8 | DELIVERED (single-week savings record) |
| JOB-003: Ensure meal plan respects dietary restrictions | 9 | DEFERRED — S03 (filter scaffold in place, tag engine placeholder) |

**Baseline**: 30-45 min/week manual browsing → <2 min via the app (to be measured at 4-week check).

---

## Work Completed (Execution Log)

| Step | Name | Result | Date |
|------|------|--------|------|
| 01-01 | Shared foundation: schema, db, dietary, types | PASS | 2026-07-13 |
| 01-02 | Scraping pipeline and discount registration | PASS | 2026-07-13 |
| 01-03 | Discount HTTP feed: GET / | PASS | 2026-07-14 |
| 01-04 | Plan generation and savings tracking (D23 atomic) | PASS | 2026-07-14 |
| 01-05 | Server composition root (D35 wire order) | PASS | 2026-07-14 |

**Tests at close**: 26 pass, 4 skip (Scenario 2 @skip per DISTILL prereq — enable in S02), 0 fail.

---

## Demo Evidence (Post-Merge Integration Gate)

**US-01 — Discount feed (GET /)**
- Status 200; item names present (Bio Haferflocken, Rote Linsen); both prices rendered (2.29 was, 1.49 sale); "Generate Meal Plan" visible.

**US-02 — Meal plan (POST /plan/generate → GET /plan)**
- POST 200; GET 200; `data-estimated-savings: 210` cents (€2.10).

**US-04 — Savings tracker (GET /savings)**
- Status 200; `data-saved-amount: 210` cents; D23 invariant confirmed (plan savings == savings record).

**US-03** (recipe detail) — deferred to S05.
**US-05** (dietary settings) — deferred to S03.

---

## Key Decisions

### DISCUSS Wave (D1–D10)

| ID | Decision |
|----|----------|
| D1 | JTBD analysis — all stories trace to jobs.yaml |
| D3 | Walking skeleton = SLICE-01: one store, one discount, one meal, one saving |
| D5 | Elephant Carpaccio slicing: ≤1 day per slice |
| D6 | Aldi Süd: plain HTTP (no Playwright); prospekt.aldi-sued.de serves static JSON — SPIKE-01 validated |
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

---

## Issues Encountered and Resolution

| ID | Issue | Resolution |
|----|-------|------------|
| D1 | XSS — item names unescaped in HTML output | Open: schedule for S02 hardening |
| D2 | No HTTP error boundary on plan generation | Open: schedule for S02 hardening |
| D3 | Zero-assertion test in db.test.ts | Fixed: test deleted (commit 046674d) |
| D4 | D23 atomicity — happy-path only; failure-injection test missing | Deferred: failure-injection test to S02 |

---

## Lessons Learned

1. **Fake injection via env vars works cleanly for CLI subprocesses.** `CATALOGUE_SOURCE=fake` + `FAKE_CATALOGUE_FIXTURE` path allows the acceptance test to own the fixture without mocking the subprocess boundary. No subprocess-mocking framework needed.

2. **Both-price filter at ACL boundary eliminates a class of savings calculation bugs.** CatalogueNormalizer drops items missing either `price` or `discountedPrice` before they reach the domain layer. The Savings Tracker never sees items it cannot compute savings for.

3. **Same-transaction write (D23) made consistency testing trivial.** Testing the D23 invariant was a single HTML attribute comparison (`data-estimated-savings == data-saved-amount`), not an async reconciliation.

4. **SPIKE-01 saved significant time.** Validating the Aldi Süd catalogue endpoint (plain HTTP, static JSON, HEAD→302 slug) before DESIGN meant the scraper architecture was committed without a live-network risk. The spike finding that only ~20% of catalogue items carry both prices was also essential for setting realistic plan size expectations.

5. **Lean v3.14 single-file feature-delta proved adequate for S01.** DISCUSS, DESIGN, DISTILL, and DELIVER evidence consolidated into one file. No separate wave-decisions.md files were needed; the delta sections stay navigable at this scope.

---

## Open Questions Carried Forward

| ID | Question | Target Slice |
|----|----------|-------------|
| OQ-1 | Brave Search API key validation | S05 |
| OQ-2 | Edeka and V-Markt scraping feasibility | S02 |
| OQ-3 | servicePoint / store codes for Munich Edeka + V-Markt | S02 |
| OQ-4 | Dietary keyword classifier coverage | S03 |
| OQ-5 | Docker overlayfs SQLite fsync risk | Platform / DEVOPS wave |

---

## KPI Baselines

Formal measurement begins at 4-week mark (weekly use). Baselines captured at S01 close:

| KPI | Baseline | Target | Measurement |
|-----|----------|--------|-------------|
| Grocery browsing time | 30-45 min/week (manual) | < 2 min | Self-reported at 4-week check |
| Weekly plan adoption | 0 weeks/month | ≥3 weeks/month | meal_plans table row count |
| Monthly savings | €0 tracked | ≥€20/month after 4 weeks | savings_log cumulative total |
| Dietary violations | N/A (manual review) | 0/week | Self-reported |

Note: `docs/product/kpi-contracts.yaml` not present; baselines recorded here only. Formal KPI contract file deferred — no validated live data yet (walking skeleton uses fake catalogue).

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
| Walking skeleton spec | `tests/acceptance/discount-hunt/walking-skeleton.feature` |
| Acceptance test | `tests/acceptance/discount-hunt/walking-skeleton.test.ts` |
| Feature workspace | `docs/feature/discount-hunt/` |
| Slice plans | `docs/feature/discount-hunt/slices/` |
| Spike findings | `docs/feature/discount-hunt/spike/` |

---

## Next Iteration

**S02**: Full 7-day plan + all 3 stores (Aldi Süd + Edeka + V-Markt).
- Learning hypothesis: Does discount-first planning work when ingredient variety is real?
- Blocked on: OQ-2 (Edeka/V-Markt scraping feasibility spike), OQ-3 (store codes)
- Hardening also due: D1 (XSS), D2 (HTTP error boundary), D4 (D23 failure-injection test)
