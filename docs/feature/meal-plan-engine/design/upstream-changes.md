# Upstream Changes — meal-plan-engine DESIGN (back-propagation contract)

**Wave**: DESIGN · **Date**: 2026-07-17 · **Agent**: Morgan (nw-solution-architect)

DESIGN discovered that a DISCUSS/SPIKE acceptance bar must change. Recorded here per the back-propagation
contract rather than silently editing upstream artifacts.

---

## UC-1: Coverage bar ≥2-product → ≥1 discounted anchor per meal

**Source of truth for the change:** SPIKE-00 §6.2 + RUN 4 (`spike/findings-00-basket-recipe-search.md`).
RUN 4 empirical: ≥1 discounted anchor/meal = **5/5 found (100%)**; ≥2 = strict **1/5** (occasional bonus,
not reliable). Strict ≥2 had ZERO positive evidence across all runs (0/24 in RUN 1). ≥2 was an invented
threshold; the feature-delta value stories already require ≥1.

**Change:** the acceptance bar for a meal is **≥1 discounted anchor per meal**, not ≥2. This is the SPEC
per SPIKE reshape, not a retreat.

**Where the ≥2 bar actually lives (must be updated / annotated in DELIVER):**

| Location | Line(s) | Current text | Action |
|---|---|---|---|
| `slices/slice-00-spike-basket-recipe-search.md` | 11, 15, 25, 32 | "≥2 of the basket products" hypothesis + measurement | Annotate: SPIKE-closed; reshaped to ≥1 anchor |
| `feature-delta.md` — Critical error paths | 195 | "no real recipe uses ≥2 discounted products" | ✅ APPLIED — now "≥1 discounted anchor" (SPIKE-reshaped note + UC-1 ref); degrade path preserved |
| `feature-delta.md` — Priority Rationale (S00 row) | 228 | "using ≥2 of them" | ✅ APPLIED — now "≥1 discounted anchor" annotated "SPIKE-reshaped from the original ≥2 hypothesis" |
| `feature-delta.md` — Risks (row 1) | 851 | "returns ≥2-product dietary-safe recipes" | ✅ APPLIED — now "≥1-anchor … (SPIKE-reshaped from ≥2 — UC-1)" |
| `slices/slice-01-...md` (01b) | — | inherits SPIKE ≥2 framing | 01b AC = ≥1 anchor/meal + mandatory post-fetch dietary verifier + refusal-sentinel (if LLM) |
| US-MPE-01 domain examples | 309–314 | 2-product example recipes ("uses Rote Linsen + Campari Tomaten") | Keep as ILLUSTRATIVE (≥2 is a bonus, not required); no AC change |

**IMPORTANT — pointer mismatch (flagged, NOT forced):** the DESIGN task instructed writing the ≥2→≥1
change against "US-MPE-03 AC and KPI-3". Verified against the text: **US-MPE-03 AC and KPI-2 already read
"≥1 discounted product"** (feature-delta lines 497, 506, 732), and **KPI-3 is a DIFFERENT metric** —
breadth-of-deals coverage ("≥60% of selected deals appear in the plan", line 733), unrelated to the
per-meal ≥2 bar. The ≥2 bar is NOT in US-MPE-03/KPI-3; it lives in the SPIKE + slice-00/01b + error-path +
Risks (table above). The change is recorded where the ≥2 text truly is. The task's pointer is recorded as
an **unresolved contradiction** (see wave-decisions.md and the return summary) — I did not force an edit
into US-MPE-03/KPI-3 that the text does not support.

---

## UC-2: Two SPIKE bugs promoted to explicit DELIVER fixes (regression-tested)

Per CLAUDE.md bug-handling (fix proactively + regression test in DELIVER). Flagged in the design, fixed in
DELIVER, not here:

1. **Refusal-prose-fed-to-search** (SPIKE §3 / §9): an LLM refusal was fed to Chefkoch search →
   `found=true` garbage ("Mr. Tea"). Fix: a `SKIP` refusal-sentinel contract; refusal prose NEVER reaches
   search. Only relevant if the optional LLM query path (D45) is enabled.
2. **`tokensOverlap` word-boundary over-matcher** (SPIKE §3): substring match false-positived
   (`reis` ⊂ `preiselbeeren`; `hack` ⊂ `gehackt`). Fix: word-boundary match. Display-only heuristic — the
   NEW `DietaryVerifier` is the safety gate, not this.

---

## UC-3: New mandatory AC on slice-01b (dietary safety, defense-in-depth)

> **ADR-008 reverted to Chefkoch-primary (2026-07-18) — the RUN-5 dietary proof RESTORES.** RUN-5's
> forced-`vegetarisch` 40%→0% result was measured ON CHEFKOCH, which is again the shipped source, so the
> proof holds. The layers below return to the SPIKE §10 posture (German-only) and the residual-leak
> measurement is **RECOMMENDED, not a blocking gate** — the verifier is defense-in-depth.

Add to slice-01b AC (SPIKE RUN-4/5):
- Layer 1: forced German dietary query term `vegetarisch` (shipped in `buildRecipeQuery`).
- Layer 2 (NEW, D40): mandatory post-fetch `DietaryVerifier` — deterministic word-boundary German-focused
  non-veg blocklist over FULL fetched ingredient lists + title; reject + re-pick, never surface.
  Must skip any result without a parseable `schema.org/Recipe` (no `ingredients[]` → cannot verify →
  reject, never surface unverified). Gold-test the RUN-4 known lies (Schinken, Kalbsbrät → REJECT).
- Refusal-sentinel AC if the LLM query path is enabled.

**Verifier completeness gate (closes peer-review HIGH — JOB-003 is a 100%-no-violation hard constraint,
so the blocklist's false-negative rate is load-bearing):**
- Blocklist gold-test corpus MUST cover the common German non-veg keyword families (Chefkoch is a German
  source), not just the 2 known lies:
  - `Schinken`/`Speck`/`Wurst`/`Salami` (pork), `Hackfleisch`/`Rind`/`Kalb`/`Kalbsbrät`/`Gulasch`
    (beef/veal), `Hähnchen`/`Huhn`/`Pute`/`Geflügel` (poultry), `Fisch`/`Lachs`/`Thunfisch`/`Hering`/`Garnele`
    (fish/seafood), `Gelatine` (vegan).
  - (Harmless EN terms may remain in the blocklist — no need to trim; German coverage is what matters.)
  - Word-boundary matched (must NOT re-introduce the substring over-match: `hack` ⊄ `gehackt`,
    `reis` ⊄ `preiselbeeren`).
- **Residual-leak measurement (RECOMMENDED, not blocking):** the SPIKE RUN-5 Chefkoch 0-leak proof holds;
  the verifier is defense-in-depth. Measure residual false-negative leak over the first weeks in real use and
  harden the blocklist if any leak surfaces. This is NOT a pre-ship blocking gate (single German source; the
  Chefkoch measurement is the baseline).
- **Runtime guardrail (DEVOPS instrumentation, feature-delta KPI guardrail line):** emit a structured alert
  event on ANY non-veg keyword surfacing to a vegetarian/vegan plan (the 100% guardrail). This is the
  fail-safe if a blocklist gap escapes the gold-test.

**Refusal-sentinel code location (closes peer-review MEDIUM):** the `SKIP` sentinel is a return-contract of
the optional LLM query path — implemented in the LLM query-builder adapter (a new
`src/recipe/adapters/llm-recipe-query.ts` wrapping the shipped `resolveLlm` port), NOT in the pure
`buildRecipeQuery`. Regression test (UC-2): LLM refuses a non-food basket → the refusal string is discarded,
NEVER passed to `RecipeSource.find`. Only wired if D45's LLM path is enabled (off by default).

**Cold-cache degradation path (closes peer-review MEDIUM, adr-006 Option D):** if a basket has no cached
recipe at generation time (warmer not yet run for it), the orchestrator falls back to the live-throttled
Chefkoch fetch (Option B behavior) for that basket, bounded by a per-generation timeout. If that yields
nothing, the meal shows the explicit no-recipe empty-state (US-MPE-01 AC) — NEVER a silent failure or a
fabricated meal. Specified in adr-006 (mechanism); source = Chefkoch (adr-008 reverted).

---

## UC-4: Recipe SOURCE — SUPERSEDED (2026-07-18)

> **SUPERSEDED.** This UC recorded the 2026-07-17 swap to Google multi-site (ADR-008). That decision was
> **reverted to Chefkoch-primary** the next day when the Google Custom Search JSON API proved unbuildable
> (discontinued + closed to new customers; whole cheap-search-API category collapsed — see ADR-008
> Supersession). The swap never shipped: the Google adapter + composite were RED scaffolds only, now deleted.

**Current state (post-revert):**
- Recipe source = **Chefkoch** (shipped `ChefkochRecipeSource`) as the primary/sole source behind the
  unchanged source-agnostic `RecipeSource` port. No Google, no composite, no API key, no CSE quota gate.
- Discovery shape unchanged: Chefkoch site-search → first result → JSON-LD `schema.org/Recipe` (as the
  shipped code already does). `find()` returns null on no parseable Recipe (never fabricated).
- `src/server.ts` already wires `ChefkochRecipeSource` directly as the default — SSOT is consistent, no code
  fix pending. The `RecipeSource` port keeps a future source addable without redesign IF a viable low-cost
  option reappears (versatility deferred, not foreclosed — ADR-008). Documented escalation if Chefkoch
  coverage disappoints in real use: a local-harvested corpus (not now, per KISS/YAGNI).
- Coverage: SPIKE-proven on Chefkoch (71% found, ≥1 anchor 100%) — Chefkoch IS the baseline; no coverage
  regression risk.
