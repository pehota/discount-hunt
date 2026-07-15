# Product Vision — discount-hunt

**Status**: SSOT product vision (the artifact above jobs/journeys). **Created**: 2026-07-15 by Scout (nw-product-discoverer).
**Evidence model**: owner-driven — solo builder (Dimitar + his wife), no external user base, no interviews.
This document does **not** re-derive scope that already lives in `docs/product/jobs.yaml`, the two journey
files, or `docs/feature/product-overhaul/feature-delta.md`. It sits **above** them and points to them.

> **Honesty contract for this document.** Every claim below is either (a) grounded in the *shipped,
> running, browser-verified product* or the *owner household's real stated goals* — tagged
> **[owner-validated]** — or (b) a directional bet that would need external validation before building
> for strangers — tagged **[unvalidated-for-others]**. Nothing here reports a measured customer outcome.
> No interviews, quotes, sample sizes, or gate passes were invented. Targets that appear in the
> feature deltas (e.g. "≥40% of spend on discounts", "20–30% monthly reduction") are **hypotheses/
> targets, not measured results**, and are treated as such.

---

## 1. North-star

> **discount-hunt is an everyday savings / life-hacking companion whose main goal is to help a household
> manage and reduce everyday expenditure — starting with groceries, and eventually expanding with
> additional, related, everyday life-hacking features.**

Framing (owner's words): the product is not a meal planner and not a recipe app. It is a **companion for
spending less, deliberately, on the recurring costs of ordinary life.** Groceries are the first proven
surface; they are the beachhead, not the boundary.

The single **opportunity statement**:

> A household that wants to spend less on everyday life has no single, low-effort companion that turns the
> recurring, fragmented, manual work of finding savings (across stores, prices, and decisions) into a
> deliberate, costed, in-control choice — starting where that work bites weekly and hardest: the grocery shop.

---

## 2. Pillars

The vision is a **companion made of pillars**. Each pillar is one everyday-expenditure surface. Pillar 1 is
proven and shipped; every other pillar is an **illustrative directional bet**, not a plan, roadmap, or
commitment. The pillar model exists so the product can grow *by adding a surface*, not by rebuilding.

### Pillar 1 — Grocery-expenditure control · **[owner-validated] · status: SHIPPED / proven**

**What it is**: control of the household's weekly grocery spend — knowing and reducing what the shop costs,
before and after the till — assembled from this week's real discounts plus the staples they need, with
meal-plan and recipe inspiration as supporting decision-support.

**Why it is validated (the real grounding, not a claim about strangers)**:
- The product **exists and runs**. Real scrapers (Aldi Süd, V-Markt, catalogue extraction), a discount
  feed grouped by store with regular + sale prices, discount-driven 7-day meal-plan generation, a savings
  tracker, Chefkoch recipe integration, and dietary filtering are all **shipped** across
  `src/{scraping,discount,meal-planning,savings,recipe,preferences,shared}/`. A styled, responsive UI
  shell (design system + responsive card-grid in `src/shared/layout.ts`) also ships; the mobile-first
  redesign (`discount-hunt-ui`) is **shipped and browser-verified at 375px** — 0 horizontal overflow on
  all pages, bottom-tab-bar nav, savings hero, ≥44px tap targets (commits `4c11fc6`, `aa1a29c`).
- It is **browser-verified and test-backed**: the DELIVER demo-evidence records the acceptance suite at
  **17 pass / 4 skip / 0 fail** for S01+S02 (see `docs/feature/discount-hunt/feature-delta.md` §DELIVER Demo Evidence).
- It maps to **real household frustrations** the owner stated (30–45 min/week of flyer browsing across 3
  JS-hostile sites; no way to connect "oats on sale" to "make overnight oats"; savings invisible → motivation
  decays — see `docs/product/personas/dimitar.yaml`).
- The owner is the household that uses it. That working product + that real use **is** the pillar-1 evidence.

**Scope (referenced, not re-derived)**: the full pillar-1 scope — additive filters (store AND category AND
name), price-ascending sort, select → persisted shopping list with running total, add non-discounted
staples, recipe inspiration seeded from a selection or all discounts, and the JOB-004 expenditure-control
reframe — is already captured. See:
- Jobs + hierarchy: `docs/product/jobs.yaml` (JOB-004 primary; JOB-001/002/003 supporting)
- Journeys: `docs/product/journeys/grocery-expenditure-control.yaml` (primary spine) and
  `weekly-discount-meal-planning.yaml` (supporting meal-planning flow)
- Reframe + slices: `docs/feature/product-overhaul/feature-delta.md`

**Honesty note**: pillar-1 is *owner-validated* — proven to work and to serve this household. Whether it
would delight a **wider audience** is **[unvalidated-for-others]** (see the ledger, §4).

### Expansion thesis — candidate future pillars · **[unvalidated-for-others] · illustrative bets only**

If the north-star holds — a companion for reducing *everyday* expenditure — then groceries are one instance
of a general pattern: **recurring spend that is fragmented, manually tracked, and decided without a single
costed view.** The same shape (fetch fragmented data → make it one legible, costed view → turn spend into a
deliberate decision → show the payoff) plausibly transfers to other everyday surfaces.

The following are **derived hypotheses, not commitments**. None is scheduled, promised, or designed. They
exist to (a) justify the *extensibility constraint* in §5 and (b) name what would have to be learned before
any of them is built. **Verb discipline: these are bets the product *could* explore, never things it *will* ship.**

| Candidate pillar (bet) | The everyday-expenditure pattern it would target | Confidence |
|------------------------|---------------------------------------------------|------------|
| Recurring-subscription / utility savings | Fragmented recurring charges (streaming, mobile, utilities) with no single "what am I paying, is it worth it?" view | [unvalidated-for-others] |
| Price-drop / price-history tracking | Deliberate purchases where waiting for a drop saves money, but tracking is manual across sites | [unvalidated-for-others] |
| Household budgeting / spend-visibility | The whole-household spend picture that groceries are only one slice of | [unvalidated-for-others] |
| Waste reduction (use-it-up) | Money lost to food/goods bought and not used — a savings surface adjacent to groceries | [unvalidated-for-others] |

> These four are **illustrative**, chosen to span the "life-hacking" framing. They are not a shortlist to
> pick from; the owner may want entirely different pillars. See §6 (open item for the user).

---

## 3. How this vision recontextualizes (does not discard) product-overhaul

`product-overhaul` (the JOB-004 reframe + shopping-list-as-central-artifact) is **fully preserved and
re-read under this vision** — not superseded:

- **The reframe was already the right move at pillar-1 scope.** product-overhaul reframed grocery *meal
  planning* down to *supporting* and made *controlling grocery spend* (JOB-004) primary. Under the companion
  vision, that reframe is simply pillar-1 stating its own goal in the vision's own language:
  **expenditure control**. The vision generalizes what product-overhaul discovered locally.
- **The shopping list as central artifact is a pillar-1 realization of a companion-level idea.** "Assemble a
  deliberate, costed set of intended spend, know the total before you commit" is the grocery instance of the
  companion's general move. Nothing about it needs to change; it is recontextualized, not rewritten.
- **Architectural implication (the load-bearing one)**: product-overhaul's central artifact (the persisted
  shopping list / running total) and its supporting-flow fan-out (feed → list → plan | recipes) are
  **pillar-1-shaped**. The paused DESIGN wave must build them *inside pillar 1's context modules* in a way
  that does not assume grocery is the only pillar — i.e. honor the extensibility constraint in §5. This does
  **not** mean building expansion pillars now; it means not painting them out.

No jobs, journeys, or decisions from product-overhaul are deleted or renumbered. This vision adds a layer
above them.

### North-star relationship (surfaced SSOT tension — not a contradiction)

The existing deltas name **grocery-level** north-stars: `discount-hunt` uses "cumulative monthly savings (€)";
`product-overhaul` uses "% of weekly shop spend (€) on discounted items". **This vision's north-star sits
*above* those** — it is the *product-level* companion goal ("help the household manage and reduce everyday
expenditure"), of which the grocery metrics are the **pillar-1 measurement**. They are a **hierarchy, not a
competition**: product-level north-star → pillar-1 (grocery) north-star metrics → per-feature KPIs. I flag
this explicitly so the vision reads as recontextualization; the feature-level SSOT metrics remain the
authoritative measures for pillar 1 and are not overwritten here.

---

## 4. Honest assumption ledger

Split by confidence. The left column is grounded; the right column is what would have to be **learned**
(not assumed, not tested here) before building for anyone beyond the owner household.

### [owner-validated] — grounded in the shipped product and the owner's real goals

| # | Assumption | Grounding (real, not invented) |
|---|------------|--------------------------------|
| OV-1 | The grocery-expenditure problem is real and weekly for this household | Owner's stated frustrations + goals in `personas/dimitar.yaml`; the household is the user |
| OV-2 | A working solution to it is buildable at low/zero cost, solo, locally | It is **built and running** — `src/`, 17-pass acceptance suite, local Bun+SQLite process |
| OV-3 | Discount data can be obtained without headless browsers / paid infra | SPIKE-01 + shipped plain-HTTP scrapers (Aldi Süd `prospekt` endpoint, V-Markt); D6 |
| OV-4 | Forward spend control (know the shop cost before the till) is the missing half | product-overhaul reframe rationale (JOB-004); the shipped app only measured savings *after* |
| OV-5 | Reuse (single price/savings source, extend Chefkoch, persist the selection) beats rebuild | product-overhaul D-PO-9/10/11; shipped `RecipeService`/`ChefkochRecipeSource` |
| OV-6 | Dietary safety (vegetarian) is a hard constraint on anything surfaced | Owner is vegetarian (`personas/dimitar.yaml`); shipped `isCompatible()` shared kernel (D33) |

### [unvalidated-for-others] — hypotheses that would need external evidence before building for strangers

| # | Assumption | What would need to be learned (NOT tested here) |
|---|------------|--------------------------------------------------|
| UV-1 | A wider audience feels the grocery-expenditure pain strongly enough to adopt | Real interviews / behavioral signals from non-owner households (past behavior, not opinions) |
| UV-2 | The "life-hacking companion" framing resonates beyond one owner | Whether strangers see one companion vs. four separate tools; naming/positioning validation |
| UV-3 | Any expansion pillar (subscriptions, price-drop, budgeting, waste) is wanted | Per-pillar problem validation; none has any evidence today — all are directional bets (§2) |
| UV-4 | Munich/German-grocery + English-UI scope generalizes to other locales | Store/locale coverage, scraper viability, and demand in any new market |
| UV-5 | There is a viable *business* (channels, willingness to pay, unit economics) | Entirely unexplored — there is no market, revenue, or distribution today (see §5 viability) |
| UV-6 | Scraper resilience holds at multi-user scale / under store countermeasures | Currently sized for one household's weekly read; scale + anti-bot posture untested |

> **On the loaded discovery machinery (Lean Canvas, opportunity-algorithm scoring, G1–G4 gates,
> 5-interview minimums)**: loaded per protocol, but the customer-evidence machinery is **overridden by the
> owner-driven adaptation**. There is no market, no revenue, and no one to interview, so **no gate is
> claimed as passed** and **no canvas is fabricated**. Viability here means *sustainability for the owner
> household* (§5), not a business model.

---

## 5. Constraints (evidence-backed)

These are the constraints the paused DESIGN wave must honor. Each is grounded in the shipped stack or the
owner's real situation — not aspirational.

| # | Constraint | Evidence / source |
|---|------------|-------------------|
| C-1 | **Solo build** — one developer (+ his wife as household user); no team | `personas/dimitar.yaml`; owner-driven evidence base |
| C-2 | **Local-first** — runs as a local process; no cloud dependency required | D11 modular monolith, D15 bare process/Docker, D13 SQLite; shipped |
| C-3 | **Low/zero running cost** — free tiers only; no paid infra | D6 plain-HTTP scraping (no headless), D7 Brave free tier, SQLite; shipped |
| C-4 | **Bun + SQLite modular monolith** — one Bun process, logical context modules | D11/D13/D17/D26/D29/D30; shipped `src/{context}/` layout |
| C-5 | **English UI / German grocery context** — UI in English, data/vocab German | `personas/dimitar.yaml` (Wochenangebote, Angebot, Stammpreis); D10 locale extensibility |
| C-6 | **Single-user / no auth** — "household" = whose budget, not extra accounts | D9; product-overhaul household block |
| **C-7** | **Extensibility for new pillars** — the architecture must let a *new expenditure pillar* be added **without reworking pillar 1** | **See below — this is the constraint the vision adds for DESIGN** |

### C-7 — the extensibility requirement (load-bearing output for DESIGN)

**Constraint (stated, not designed)**: adding a future expenditure pillar (§2 bets) must be possible by
**adding a new context module and its ports/adapters** — following the *existing* pattern — **without
rewriting pillar-1's grocery code**. The shopping-list / feed / savings machinery must not be built in a way
that hard-codes "grocery" as the only possible expenditure surface where a pillar-neutral seam is cheap.

**Evidence this is already achievable (so it is a real constraint, not a fantasy)**:
- The codebase is **already** organized as per-context modules under `src/{context}/` with enforced
  boundaries (D26; `dependency-cruiser` at D34) and a single composition root (D35).
- The system **already** carries a store/locale abstraction meant to grow a dimension (D16: `store` column
  + per-store scraper module; D10 locale extensibility). A pillar is a coarser version of the same "add a
  dimension by adding a module" move.
- Ports-and-adapters (hexagonal, D26/D35) already isolate external surfaces behind ports.

**Boundary of this constraint (Scout does not design it)**: this section states *that* extensibility is
required and cites *why it is feasible*. **How** to realize it (e.g. a pillar abstraction, a shared
"expenditure surface" kernel, or simply disciplined new context modules) is a **solution-architect
decision** in the DESIGN wave — explicitly out of scope for this vision. Do not over-abstract pre-emptively;
the requirement is "addable without rework", not "build the abstraction now".

---

## 6. Open item for the user (does not block)

The four expansion pillars in §2 are **illustrative candidates** derived from the "life-hacking" framing, to
justify the extensibility constraint. I have **not** committed to any of them. **Open question for the
owner**: are these acceptable as plainly-labeled illustrative bets, or does the owner want specific,
different candidate pillars named? Default (within mandate): keep them illustrative and unlabeled-as-roadmap.
This does not change any deliverable or block DESIGN.

---

## 7. Self-review (no customer-development reviewer — inline, per adaptation)

Coherence + no-fabrication audit, per-claim:

- **No invented evidence.** No interviews, verbatim quotes, sample sizes, Mom-Test transcripts, or customer
  validation gates appear. The word "validated" is only ever applied as **[owner-validated]** (product runs /
  owner goals) — never as a customer-evidence claim.
- **Feature-delta targets are labeled as hypotheses/targets, not results.** The §1/§4 honesty notes and the
  UV ledger explicitly demote "≥40% spend", "20–30% reduction", "≥3/4 in budget" to targets.
- **Every declarative claim traces** to either the shipped product / owner goals (tagged owner-validated) or
  is tagged as an unvalidated bet. Expansion pillars use hypothesis verbs only ("could", "would", "bet") —
  never "will/next/roadmap".
- **No re-derivation.** Pillar-1 scope is referenced to `jobs.yaml`, the journeys, and the product-overhaul
  delta; not restated (honors the SSOT / single-source rule).
- **No fake business model.** Lean Canvas / gates / opportunity-algorithm scoring are explicitly overridden;
  viability is reframed as owner-household sustainability.
- **Extensibility constraint is stated and evidence-backed but not designed** — the how is left to DESIGN.
- **SSOT tension surfaced** (product-level vs grocery-level north-star) as a hierarchy, not a contradiction.

Verdict: coherent; zero fabricated evidence.
