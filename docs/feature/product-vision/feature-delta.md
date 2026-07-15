# Feature Delta: product-vision

**Wave**: DISCOVER | **Date**: 2026-07-15 | **Agent**: Scout (nw-product-discoverer)
**Density**: lean | **Feature type**: Vision-level (owner-driven; NOT customer-development discovery)

> The real artifact is **`docs/product/vision.md`** (SSOT product vision). This delta is a thin Tier-1
> workspace record for the wave; it **references** vision.md and does not duplicate it. It seeds **no**
> new jobs or journeys — the SSOT jobs (`docs/product/jobs.yaml`) and journeys already exist; the vision
> sits **above** them.

---

## Wave: DISCOVER / [REF] Persona

Dimitar Apostolov (+ his wife, shared household budget) — solo builder and only user. Full profile:
`docs/product/personas/dimitar.yaml`. Evidence base: **owner-driven** — no external users, no interviews;
interview thresholds and G1–G4 customer gates are overridden by design (see vision.md §4 honesty note).

---

## Wave: DISCOVER / [REF] Opportunity Statement

See `docs/product/vision.md` §1. One sentence: a household wanting to spend less on everyday life has no
single low-effort companion turning fragmented, manual savings work into a deliberate, costed decision —
starting with the weekly grocery shop.

---

## Wave: DISCOVER / [REF] Validated / Invalidated Assumptions (honest confidence)

Full ledger: `docs/product/vision.md` §4. Summary:
- **[owner-validated]** (grounded in the shipped, browser-verified product + owner goals): OV-1…OV-6 —
  the grocery-expenditure problem is real for this household and a working, low-cost, local solution is
  **built and running** (17-pass acceptance suite; `src/{context}/`).
- **[unvalidated-for-others]** (would need external evidence before building for strangers): UV-1…UV-6 —
  wider-audience desirability, the companion framing's resonance, every expansion pillar, locale
  generalization, a viable business model, and scraper resilience at scale.
- **No assumption is marked "invalidated"** — none was tested against external evidence; the honest state
  is owner-validated *or* unvalidated-for-others.

---

## Wave: DISCOVER / [REF] Dropped / Deferred Options

- **Customer-development discovery machinery** (Mom-Test interviews, opportunity-algorithm scoring, Lean
  Canvas, G1–G4 gate passes): dropped — no market / no interviewees. Overridden by the owner-driven
  adaptation; **no gate claimed as passed**, **no canvas fabricated** (vision.md §4).
- **Committing to any expansion pillar**: deferred — the four candidate pillars are **illustrative bets**,
  not a roadmap (vision.md §2). Open item for the user (vision.md §6).
- **Designing the pillar-extensibility abstraction**: deferred to DESIGN / solution-architect — the vision
  states the *constraint*, not the *design* (vision.md §5, C-7).

---

## Wave: DISCOVER / [REF] Constraints

Full list with evidence: `docs/product/vision.md` §5. C-1 solo build · C-2 local-first · C-3 low/zero cost ·
C-4 Bun+SQLite modular monolith · C-5 English UI / German grocery context · C-6 single-user/no-auth ·
**C-7 extensibility — a new expenditure pillar must be addable without reworking pillar 1** (the load-bearing
constraint the paused DESIGN wave must honor).

---

## Wave: DISCOVER / [REF] Pre-requisites

- Vision sits above existing SSOT: `docs/product/jobs.yaml`, `docs/product/journeys/*.yaml` — referenced,
  not modified by this feature.
- Recontextualizes `docs/feature/product-overhaul/feature-delta.md` (pillar-1 scope) — see vision.md §3.
  product-overhaul's paused DESIGN wave inherits the C-7 extensibility constraint.
- Open user item (non-blocking): confirm whether the illustrative expansion pillars are acceptable as-is or
  should be replaced with owner-specified candidates (vision.md §6).
