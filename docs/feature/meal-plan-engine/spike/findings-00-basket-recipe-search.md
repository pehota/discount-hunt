# SPIKE-00 findings: basket → real-recipe search feasibility

**Feature**: meal-plan-engine · **Slice**: slice-00 (Spike) · **Job**: JOB-001 feasibility (parent JOB-004)
**Date**: 2026-07-17 · Raw data: `raw-results.json` (RUN 1), `raw-results-2.json` (RUN 2), `raw-results-3.json` (RUN 3)

---

## 1. Verdict

**RESHAPE for D1.** NO-GO on the *naive* D1 design (real-time Chefkoch search per meal as the generation engine) — blocked primarily by Chefkoch's sticky rate-limit at interactive generate+regenerate volume; NOT a NO-GO on the feature, which survives if recipe sourcing is decoupled from live per-query scraping (cache/bulk corpus or quota'd API) and post-fetch dietary verification is made mandatory.

---

## 2. What was tested + how

Probed the shipped `ChefkochRecipeSource.find()` (one search → first result → JSON-LD) with basket-derived queries under a `vegetarisch` restriction, comparing a **rules** query builder vs an **LLM** query builder (`resolveLlm`, claude-cli dev adapter). Harnesses: `probe.ts` / `probe2.ts` / `probe3.ts`.

| Run | Baskets | Recs | Design | Outcome |
|-----|---------|------|--------|---------|
| RUN 1 | 12 (alphabetical-first per taxonomy category) | 24 (×{rules,llm}) | Included NON-FOOD categories (Household, Other) + raw brand-noisy queries | **Only valid run**: 9 found=true. Baseline before the limit tripped. |
| RUN 2 | 12 (food-only, brand-stripped, realistic cross-category) | 24 | The *good* baskets — the fair test of coverage | ALL found=false — **INVALID** (HTTP 429 contamination, not real misses) |
| RUN 3 | 6 (curated strong dish-queries, 120s cooldown, 18s spacing) | 6 | Test whether pacing recovers the limit | ALL status=429 — proves the limit is **sticky >2min** once tripped |

**Confound stated honestly**: After RUN 1 a diagnostic fetch of plain `Käsespätzle` returned HTTP 429. RUN 2 and RUN 3 therefore inherited an already-tripped limit. RUN-2/RUN-3 `found=false` is a **rate-limit block, not a genuine no-recipe result** and must not be read as coverage misses. `probe2.ts` never captured HTTP status, so a block *looks* like a miss in that file.

---

## 3. Findings by lens (numbers from the raw data)

### Throughput / rate-limit feasibility — the PRIMARY blocker
- The blocker is **burstiness against a sticky, unmeasured ceiling**, not total volume. One trip poisons the session for >2 min.
- Shipped feature: ONE lazy `find` per meal view, 7d TTL, cache-hit-dominated (`recipe-service.ts` `isFresh` short-circuits with no network). Never bursty — this is why production avoids 429 (established fact 5).
- Engine: 6–14 distinct-query resolutions per generation, each `find()` = up to 2 sequential GETs on success (search page → recipe page) = **12–28 GETs in a burst of seconds**. Regeneration with distinct dishes = cache-miss every time; 5 regens = 60–140 GETs in minutes.
- RUN 3 proof of stickiness: 6/6 still 429 after a **120s cooldown + 18s spacing (~3.3 req/min)** — far below engine volume, still fully blocked. Recovery costs minutes; the clean trip-threshold was never measurable.
- On the 429 failure path `getText` returns null before the 2nd fetch, so RUN 2 ≈ 24 GETs, RUN 3 ≈ 12 GETs — all blocked.

### Multi-product coverage (≥2 basket products)
- RUN 1 (only valid run, 24 recs): `lenientGte2=true` in **1/24**; `strictGte2=true` in **0/24**. Strict ≥2 has ZERO positive evidence anywhere.
- Among the 9 found=true recs, `lenientProductsUsed` = [1,1,2,1,1,0,0,1,0] → 1/9 lenient, 0/9 strict. **Recipe-found does NOT imply product-coverage.**
- Ceiling barely at threshold: max lenient observed = 2 (one rec); max strict = 1. No record ever reached strict=2.
- The lone lenient success is doubly confounded: (a) same-category **dairy** basket (easy case, not realistic cross-category), (b) the 2nd match is a `tokensOverlap` lenient hit — the KNOWN over-matcher (`reis` ⊂ `preiselbeeren`). Its strict count is only 1.
- Non-food baskets scored 0/0 by construction (Household, Other). The inputs most likely to hit ≥2 (RUN 2/3 clean food + curated dish-queries) were 429-contaminated → **clean-basket coverage = 0 valid fetches.**

### Dietary safety (JOB-003 hard vegetarian constraint)
- Raw scan flagged 3/9 fetched recipes (`dietaryLeakCount>0`): Drinks/llm, Household/rules, Meat&Fish/rules. All 9 queries carried explicit veg intent.
- **TRUE leaks = 1/9 (~11%)**: Meat&Fish/rules → "Bierbrot", ingredient `150 g Röstzwiebeln (oder 1 Pck. Schinken, gewürfelt)` matched `~schinken`. Real meat surfaced despite a query literally containing `vegetarisch`. **This is the proof: query-biasing does NOT guarantee a vegetarian result.**
- The other 2 flags are FALSE POSITIVES: `hack` matched inside `gehackt`/`gehacktes` (chopped, not Hackfleisch) — both veg/vegan recipes. The scan over-flags.
- The scan cannot be the verifier: fallible in the visible direction (2/3 flags wrong). A hard constraint needs a stronger gate (structured diet metadata / LLM classification / ingredient allow-list).
- **Unmeasured, safety-critical**: raw JSON records only the single flagged ingredient, not full ingredient lists or titles → the FALSE-NEGATIVE rate (meat the scan MISSES) is unquantifiable. "1 leak" must NOT be read as "mostly safe".
- A reject→re-search loop compounds 429 risk (every rejection = another live request against a sticky limit).

### LLM vs rules query-building + input hygiene
- **Rules brand-stripping: 0/12.** Every rules query is raw brand concatenation, e.g. `Bäcker Bachmeier Bayerische Laugensemmeln Backstube Wünsche Butterbreze Backstube Wünsche Erdbeertasche vegetarisch Rezept`.
- **Rules construction defect**: uses only the FIRST 3 products (drops the 4th) — cannot select or reorder, only truncates.
- **LLM brand-stripping: ~7/9 clean** (excl. 3 refusals). One partial slip: `Eiskuchen mit Bahlsen Keksen` retains a brand.
- **LLM refusals correct 3/3**: Household non-food, Meat&Fish all-meat, Other non-food. Rules blindly built nonsense queries for all three.
- **CRITICAL INTEGRATION BUG**: the LLM's refusal PROSE was fed straight into Chefkoch search → Household/llm `found=true`, recipe "Mr. Tea", 0 products used. **Refusal capability is worthless without a refusal-sentinel contract in the pipeline.**
- **LLM judgment is not perfect**: (a) mixed:3 (herring + 2 non-food) → "Vegetarischer Heringssalat" (fish labeled veg); (b) RUN 2 {lemon, Emmentaler} → "Käsespätzle mit Zitrone" — **hallucinates** a dish needing flour/eggs not in the basket, drifting away from the ≥2-products goal.
- **ROI**: query strategy is ORTHOGONAL to the 429 wall (both issue exactly ONE search per basket). LLM value is confined to query QUALITY; most of its edge (brand-strip + food filter) is replicable by a cheap rules pre-filter. Genuinely LLM-only capabilities = contradiction-refusal + dish synthesis, and synthesis drifts.
- Evidence the rules pre-filter suffices: RUN 2's query STRINGS are built pre-fetch (valid to cite despite 429-invalid found-rate) — with hygienic input the rules builder produced reasonable queries on its own, e.g. `Emmentaler Dinkel-Vollkornbrot vegetarisch Rezept`. Clean brand-stripped input, not the LLM, is what fixes query quality.

---

## 4. Adversarial review

- **Skeptic A** ("429 was probe impoliteness, not infeasibility"): **verdict survives** — but honestly, RUN 3 does NOT cleanly kill this. Fact 5 shows polite low-volume access works in production. RUN 3's 120s cooldown < the proven >2min sticky window, so it proves stickiness-once-tripped, NOT that a well-behaved client trips 429 from a clean state. The clean trip-threshold at engine burst volume is genuinely unmeasured.
- **Skeptic B** ("coverage unmeasured / ≥2 is the wrong bar"): **verdict survives**. Both prongs are real hits on the SECONDARY pillar — "weak coverage" is over-claimed (the honest word is *unproven*), and ≥2 is an invented threshold (feature-delta requires ≥1 product/meal). But Skeptic B touches nothing on throughput, the PRIMARY blocker. It CONFIRMS the reshape ("accept 1 discounted anchor/meal") rather than overturning it.
- **Skeptic C** ("do the reshapes exist, or is the feature infeasible under C-3 zero-cost + JOB-003?"): **verdict survives** — carried by the pre-harvested LOCAL corpus leg (slow paced crawl → offline search), which dodges the burst blocker, preserves D1 (real recipes), costs ~zero, and enables deterministic dietary screening on cached ingredient lists. The English-first thin-free-tier APIs (Spoonacular/Edamam) are NOT load-bearing. BUT the honest refinement stands: coverage + dietary-precision remain UNPROVEN and must be reclassified from "secondary" to **co-primary-and-still-open**.

---

## 5. PROVEN vs UNMEASURED

**PROVEN**
- Chefkoch's rate-limit is real and **sticky >2 min** once tripped (RUN 3, 3.3 req/min still 429).
- The shipped cache-first / one-search-per-view design avoids 429; an interactive generate+regenerate engine's burst (12–140 GETs) does not.
- Query-biasing does NOT guarantee dietary safety (Bierbrot leak, 1/9 real).
- Non-food discounted items exist and contaminate baskets → a food-only filter is required.
- The LLM strips brands + refuses non-food/all-meat baskets, but its judgment is imperfect (hallucination + fish-as-veg) and its refusals are silently discarded without a sentinel.

**UNMEASURED (the load-bearing gap)**
- **Clean ≥2-product (or ≥1-product) coverage on realistic food baskets** — never validly fetched; RUN 2/3 were 429-contaminated. Coverage is *unproven*, NOT *proven weak*.
- The 429 trip-threshold for a well-behaved, self-throttled client from a clean state.
- Dietary false-NEGATIVE rate (meat the keyword scan misses).

---

## 6. RESHAPE recommendations for DESIGN

Honoring C-3 (zero/low cost), JOB-003 (hard vegetarian), D1 (no LLM-invented recipes):

1. **Recipe sourcing — decouple generation from live per-query scraping.** Preferred: pre-harvested **local corpus** built by a slow, paced, backing-off crawl (~1 req / 10–30s over hours/days) into the existing 7d cache, then searched OFFLINE at generation time. Preserves D1, ~zero cost, enables deterministic dietary screening on cached ingredient lists. Alternative: a quota'd recipe API IF a viable low-cost German one is found (Spoonacular/Edamam are English-first, thin free tiers — weak). Note residual: full-site harvest is a heavier ToS/legal posture than incidental per-meal fetch — treat as a risk to confirm, not a hard blocker.
2. **Coverage bar — accept 1 discounted anchor per meal, drop the ≥2 gate.** Feature-delta requires ≥1 product/meal; ≥2 was an invented threshold and was never met (strict 0/24). This is the SPEC, not a retreat. Re-evaluate ≥2 only after the micro-probe measures clean coverage.
3. **Mandatory post-fetch dietary verification** — query-biasing is empirically insufficient. Verify AFTER fetch against full ingredient lists + title, using a deterministic non-veg blocklist AND/OR structured diet tags — **not** the current substring scan (it false-positived 2/3, and its false-negative rate is unmeasured). Fix `tokensOverlap` word-boundary over-matching at the same time.
4. **Food-only filtering** before query construction (category pre-filter) — cheap, no LLM required; removes the 25% non-food contamination seen in RUN 1.
5. **LLM query-building role** — DEMOTE to optional. Do a cheap rules pre-filter (food-only + clean brand-stripped name field) first; reserve the LLM only for contradiction-refusal + dish synthesis, and ONLY after a **refusal-sentinel contract** is added so refusal prose is never fed to search. Do not rely on LLM synthesis for ≥N-product coverage (it drifts/hallucinates).

---

## 7. Follow-up micro-probe (once the 429 clears)

A tiny, slow, cache-first coverage test — the single UNMEASURED gap:
- Wait well past the sticky window (30 min+ / fresh IP). Run 6–10 **clean food-only, brand-stripped, realistic cross-category** baskets, ONE search each, spaced ≥30s with backoff, capturing HTTP status (fix `probe2.ts` to record it).
- Measure on valid found=true only: **≥1-product hit rate**, ≥2-product hit rate, and — with a fixed word-boundary matcher + deterministic non-veg blocklist run on FULL ingredient lists — the dietary leak rate (both false-positive and, where checkable, false-negative).
- GO signal for the reshaped design: reliable ≥1-product coverage AND near-zero dietary leaks after post-fetch verification. If coverage stays ~0–1 or leaks persist, D1's real-recipe-search premise is disproven regardless of throughput.

---

## 8. Impact on the slice roadmap

- **A recipe-sourcing decision is now a DESIGN prerequisite**, not an implementation detail. slice-01 cannot assume live per-query Chefkoch search as the generation engine. DESIGN must choose local-corpus vs quota'd-API and specify the paced-harvest / cache-warming mechanism before any generation slice.
- **slice-01b changes**: the ≥2-products acceptance drops to ≥1 discounted anchor/meal; add a **mandatory post-fetch dietary verifier** (deterministic blocklist, not substring scan) as an explicit acceptance criterion; add the **refusal-sentinel contract** if the LLM query path is kept.
- Two items move from "secondary" to **co-primary open risks** carried into DESIGN: clean-basket coverage and dietary false-negatives. Gate them behind the micro-probe (§7).
- Bug to fix regardless of feature direction: the refusal-prose-fed-to-search integration bug and the `tokensOverlap` over-matcher.
