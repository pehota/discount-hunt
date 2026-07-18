# ADR-006: Recipe-Sourcing Mechanism for the Meal-Plan Engine

**Status**: Accepted — Option D LOCKED (user sign-off 2026-07-17)
**Date**: 2026-07-17
**Wave**: DESIGN (meal-plan-engine) · **Deciders**: Dimitar (owner, locks), Morgan (solution architect)
**Relates to**: D1 (real web recipes only), D39; SPIKE-00 (`spike/findings-00-basket-recipe-search.md`)

> **Scope note (2026-07-18 — ADR-008 superseded):** this ADR decides the **MECHANISM** (warm-vs-live) and
> stays LOCKED — NOT re-opened. The recipe **SOURCE** briefly swapped to Google multi-site (ADR-008,
> 2026-07-17) but was **reverted to Chefkoch-primary** the next day when the Google Custom Search JSON API
> proved unbuildable (discontinued + closed to new customers; whole cheap-search-API category collapsed —
> see ADR-008 Supersession). The warm/live TARGET is therefore **Chefkoch site-search queries** (its original
> state). Where mechanism text below says "Chefkoch search URLs", that is current and correct.

---

## Context

slice-01b (real basket-recipe generation) cannot assume live per-query Chefkoch search as the generation
engine. SPIKE-00 made recipe sourcing a DESIGN prerequisite. The SPIKE verdict evolved across runs:

- Early (RUN 1–3): naive burst search trips a sticky >2-min rate-limit → NO-GO on burst.
- RUN 4: a polite self-throttled client (1 search / 35 s, browser headers) ran a plan's worth of searches
  with **0×429** → **live throttled is feasibility-proven**. ≥1 discounted anchor/meal = 100% of found.
- RUN 5: forcing `vegetarisch` into the query flipped dietary leaks 40%→0% — Chefkoch/German-specific, and
  Chefkoch is the shipped source (ADR-008 reverted), so this proof holds. The `DietaryVerifier` is
  defense-in-depth; residual leak measured over the first weeks in real use (recommended, not blocking) —
  see upstream-changes UC-3.

**Revised framing:** live-throttled is viable but SLOW (~8 min/generation, repeats every regenerate); a
pre-harvested corpus is now a SPEED optimization, not a feasibility gate.

**Discriminating constraint:** US-MPE-01's arc is "regenerate = low-cost experiment → converge until it
fits." An ~8-min regenerate contradicts the feature's reason to exist. **Latency-at-regenerate decides
this**, not feasibility. Hard project constraint: reuse over rebuild.

---

## Decision

**RECOMMENDED: Option D — bounded background cache-warm keyed to this week's actual discount products.**
Queries derived from the live discount basket (via the shipped `buildRecipeQuery`, forced German dietary
term `vegetarisch`) are resolved into the shipped 7-day `recipes` cache. A paced background crawl
(1 req / 30–35 s, exponential backoff on 429) runs Chefkoch site-search and extracts `schema.org/Recipe`.
Generation reads **cache-first** → sub-second regenerate. Dietary verification (German-focused blocklist)
runs on the cached ingredient lists (deterministic).

**FALLBACK: Option B — live throttled** (zero new code), retained as the documented fallback for the
cold-cache degradation path (see below) and if the paced-warm ToS posture ever needs to be withdrawn.

**LOCKED (user sign-off 2026-07-17):** Option D is accepted — paced background cache-warmer keyed to this
week's deals, running as a **cron one-shot right after the Monday scrape**, with **cold-cache fallback to
live-throttled fetch** (Option B behavior) per basket. The user **explicitly accepted the paced-warm ToS
posture**: a weekly gentle automated batch fetch is the *same per-fetch manners* as the shipped per-meal
fetch (browser headers, 1 req / 30–35 s, exponential backoff on 429), at higher weekly volume; the warmer
backs off and refuses (`health.warmer.refused`) if the site pushes back. Options A and C are **rejected**
(A: heaviest legal posture + blind coverage; C: English-first, thin/proprietary tiers, violates OSS-first);
Option B is **retained as the documented fallback**, not rejected.

---

## Alternatives Considered

| Option | Reuse | Regenerate UX | Cost | Dietary | Rejected because |
|---|---|---|---|---|---|
| A. Pre-harvested general corpus | New crawler + offline index (heavy) | Fast | ~0 | Deterministic | Heaviest ToS/legal posture (full-site harvest); blind coverage (queries not from real deals) |
| B. Live throttled (FALLBACK) | MAX — zero new code | ~8 min/gen, repeats — SLOW | ~0 | Post-fetch verifier | Slow UX contradicts the draft-experiment arc (kept as fallback only) |
| C. Quota'd German API (Spoonacular/Edamam) | New adapter | Fast | Thin free tier | Structured tags | English-first, thin/proprietary tiers — weak; violates OSS-first |
| **D. Cache-warm keyed to this week's deals (RECOMMENDED)** | HIGH — `RecipeService`+`ChefkochRecipeSource`+`buildRecipeQuery`; adds a paced warmer | Fast (cache-first) | ~0 | Post-fetch verifier on cached ingredients | — (chosen) |

---

## Consequences

**Positive (Option D):** most reuse-faithful (hard constraint); dodges the latency wall; queries come from
real deals (no blind-coverage risk); ~zero cost; deterministic dietary screening on cached data.

**Negative / risk to confirm (Option D):** paced warming is the same per-fetch ToS posture as the shipped
per-meal fetch, at higher volume — **the risk the user signs off on.** The warmer MUST probe (Principle 13):
exercise a known live query returns a `Recipe`; refuse-to-warm and emit `health.warmer.refused` on repeated
429. Cache staleness bounded by the shipped 7-day TTL.

**If B (fallback):** zero new code, but regenerate is slow (~8 min) — the draft-experiment UX degrades;
acceptable only if D's ToS posture is rejected.

---

## Warmer execution topology (Option D) — reuses D12/D18, no new process class

The cache-warmer runs as a **cron-triggered one-shot script** (a second `bun run` one-shot alongside
`scrape.ts`), scheduled **right after the Monday 06:00 CET scrape**. It is NOT a long-lived worker/daemon —
that reuses D12 (OS cron) and D18 (one-shot invocation) verbatim and stays inside the modular-monolith
topology (D11); it does not resurrect the Rejected-Alternative-B permanent worker.

Payoff: the current week's deals are already known post-scrape, so the warmer paces its crawl of
deal-derived queries into the 7-day cache **before the user ever opens the app**. Cold-cache at generation
time becomes the rare exception (a deal that arrived late, or a query the warmer hadn't reached), not the
common path — which is what makes the fallback below a rare event instead of a latency landmine.

**Container-topology impact:** under Option D the L2 Container diagram GAINS a cron-invoked warmer one-shot
(same shape as the shipped scraper one-shot). Under the Option B fallback the container topology is
UNCHANGED (zero new execution unit).

## Cold-cache degradation path (Option D)

If a basket has no cached recipe at generation time (the warmer has not yet run for it), the orchestrator
falls back to the live-throttled path (Option B behavior) for that basket, bounded by a per-generation
timeout. If that also yields nothing, the meal shows the explicit no-recipe empty-state (US-MPE-01 AC) —
NEVER a silent failure and NEVER a fabricated meal (D1). Option D thus degrades gracefully into its own
fallback; it never becomes a hard dependency on a warm cache.

## Enforcement

- `RecipeCandidateProvider` (read-only driving port) is the single seam; the warmer and the generation path
  both go through the shipped `RecipeSource` port (`ChefkochRecipeSource`). `dependency-cruiser`: no context
  imports Chefkoch directly — only via the port.
- Post-fetch `DietaryVerifier` is unconditional regardless of option (ADR-005 extension); German-focused
  blocklist (single German source).

---

## Warm/live TARGET (2026-07-18 — ADR-008 reverted to Chefkoch)

The Option-D mechanism is UNCHANGED and stays LOCKED. The **target of the warm/live fetch is Chefkoch
site-search queries** (its original state — the 2026-07-17 Google retarget was reverted when the Google
Custom Search JSON API proved unbuildable; see ADR-008 Supersession). The warmer and the live cold-cache
fallback (Option B behavior) both fetch Chefkoch (browser headers, 1 req / 30–35 s, exponential backoff on
429, refuse + `health.warmer.refused` on repeated 429). Cold-cache degrades to the explicit no-recipe
empty-state (never silent, never fabricated — D1). No new external system, no API key.
