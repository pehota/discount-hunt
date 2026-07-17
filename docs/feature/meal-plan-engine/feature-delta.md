<!-- markdownlint-disable MD024 -->
# Feature Delta: meal-plan-engine

**Wave**: DISCUSS | **Date**: 2026-07-17 | **Agent**: Luna (nw-product-owner)
**Density**: lean Tier-1 | **Feature type**: User-facing (meal-plan generation replaced; supporting flows wired)

> Turn today's PLACEHOLDER "meal plan" (round-robin discount items as meal names) into a **real
> discount-driven meal-plan engine**: each meal is a REAL web recipe built from this week's discounted
> products, chosen to minimise the weekly shop cost by leaning on discounts. This EXTENDS JOB-001
> (discount-driven meal planning) **in service of JOB-004** (control grocery spend). It does NOT
> re-elevate meal planning to a product goal. Docs-only; no code. Oversized → split into 6 value slices
> (1 SPIKE + 5) plus 1 linked Technical Task.

Scope, jobs, personas, and the list-centric spine are NOT restated here — see
`docs/product/jobs.yaml`, `docs/product/vision.md`,
`docs/product/journeys/{grocery-expenditure-control,weekly-discount-meal-planning}.yaml`,
`docs/product/personas/dimitar.yaml`, and `docs/feature/product-overhaul/feature-delta.md`.

---

## Wave: DISCUSS / [REF] Persona ID

**Persona**: `dimitar` — vegetarian software engineer, Munich, English UI / German grocery vocabulary,
shared household budget with his wife. Full profile: `docs/product/personas/dimitar.yaml`.
Evidence base: solo / owner-driven; interview thresholds skipped by design (see vision §4 ledger).

---

## Wave: DISCUSS / [REF] JTBD One-Liner

- **Extends JOB-001** (discount-driven meal planning, SUPPORTING) **under parent JOB-004** (control
  grocery spend, PRIMARY). One-liner: *When I plan the week's shop, I want a meal plan whose meals are
  real recipes built from this week's cheapest discounted products (and safe for my diet), so the plan
  minimises what the shop costs instead of just naming random deals.*
- **Dietary safety = JOB-003** (hard constraint on every recipe surfaced).
- **Savings/spend display reuses JOB-002** computation (retrospective half of JOB-004).

Every value story (US-MPE-01…05) traces `job_id: JOB-001` with JOB-004 as the parent value. **Dietary
safety (JOB-003) is a CROSS-CUTTING CONSTRAINT, not a standalone story** — it is enforced via US-MPE-01's
and US-MPE-03's dietary ACs, the System Constraints, and the 100%-no-violation guardrail KPI (settings
already ship; D6 = explicit settings only). No JOB-003 user story exists because dietary safety is not a
separable user outcome here. No new job is minted; `jobs.yaml` gets an additive changelog entry only (no
renumber, no rescore) — see SSOT updates below.

---

## Wave: DISCUSS / [REF] Current State (verified against code, file:line)

Today's "meal plan" is a PLACEHOLDER, not meal planning. Verified:

- `PlanService.buildMealSlot` assigns a discount item to each of 14 slots (7 days × lunch/dinner) by
  **round-robin** — `discountItems[slotIndex % discountItems.length]`; the **meal name IS the item's
  name**; no recipe, no ingredient logic, no cost optimisation
  (`src/meal-planning/plan-service.ts:75-86`, slots `MEAL_SLOTS = ['lunch','dinner']` :27, days :28).
- `estimatedSavings` = Σ(regular−sale) over the **whole selected basket** (all `discountItems`), not
  the 14 shown meals (`src/meal-planning/plan-service.ts:47-49`).
- Recipes are SEPARATE + on-demand: `GET /plan/{day}-{slot}` runs a Chefkoch search keyed on **one
  meal's name** (built by `buildRecipeQuery(mealName, slot, prefs)` →
  `src/recipe/recipe-query.ts:37-53`; source `src/recipe/adapters/chefkoch-recipe-source.ts` takes the
  **first** result link; cache-first 7d TTL `src/recipe/recipe-service.ts:21,44-71`). Ingredient↔
  discount highlighting is a display heuristic (`src/recipe/ingredient-match.ts`). Recipes are never
  part of generation.
- Two generation entry points: `getOrGenerateCurrentWeekPlan` (GET /plan; auto; all this-week items;
  dietary-filtered; **auto-saves if non-empty**; 1 plan/week frozen —
  `src/meal-planning/plan-service.ts:175-196`) and `generateFromSelection` (POST /plan/generate; feed
  checkboxes; **auto-saves** — `:158-173`). `savePlan` is replace-on-save (rewrites `meal_plans` +
  `savings_log` atomically with a double-count guard — `:95-119`).
- `mealTypes` only controls which meals get a recipe *link* (`src/meal-planning/http/plan-handler.ts:87-93`);
  `kidFriendly`/`householdSize`/`cookingTime` exist in `RecipeQueryPreferences`
  (`src/recipe/recipe-query.ts:13-18`) and shape the per-meal query, but are **UNUSED in generation**.
  No archiving of old plans — they linger keyed by week.

**Already shipped and reusable (do NOT rebuild — SSOT/DRY):**

- **Shopping list BC is live**: `GET /list`, `POST /list/add` (handles discount selection AND manual
  add), `POST /list/remove` (`src/shopping-list/http/shopping-list-handler.ts`), backed by
  `ShoppingListService.{addFromDiscountSelection,addManualItem,getCurrentList,remove}`
  (`src/shopping-list/shopping-list-service.ts:39,65,86,99`). Items carry `taxonomyCategory`. Feed
  already async-adds via `X-Requested-With: fetch` → 204. **This is the target for D2/D4.**
- **LLM port is live**: `resolveLlm` (`src/llm/resolve-llm.ts`) with `claude-cli` (dev) + `openrouter`
  (prod) adapters behind `LlmTextGenerator`. **This is the seam for D1's optional query-building.**
- `offer_history` archive-on-replace shipped (commit `aa49ff7`; see `IDEAS.md` IDEA-005 Part A) —
  the pattern slice-06 mirrors.

---

## Wave: DISCUSS / [REF] Locked Decisions (D1–D8)

Orchestrator-locked in a live session. Encoded verbatim; not re-litigated.

| ID | Decision | Verdict | Rationale |
|----|----------|---------|-----------|
| **D1** | Recipe engine | **REAL web recipes only — NEVER LLM-invented recipes.** The search query is built from the discounted products + dietary needs; the LLM MAY be used to *construct the query* (tbd — validated in the SPIKE). Upgrades today's one-item Chefkoch search → basket-aware search. | Dietary safety is a hard JOB-003 constraint; LLM-invented recipes risk hallucinating non-vegetarian ingredients. LLM-over-flyers was already rejected for hallucination. |
| **D2** | Source is contextual, not a picker | Trigger LOCATION determines the source. Feed page → the user's selected items (or ALL discounts if none selected). Shopping-list page → the shopping-list items. | No source-picker UI; the page the user is on is the intent signal. |
| **D3** (v2) | Sticky accepted meals | A user can mark individual meals as accepted; regenerating replaces only the un-accepted meals; accepted meals persist across regenerations AND across source-switches (accept on a list-based plan → go to feed → regenerate → accepted meals survive, rest regenerate). | Lets the user converge iteratively without losing good picks. |
| **D4** | Save → add-to-list prompt | On Save, ask the user whether to add the plan's discounted items to the shopping list. | Closes the loop to JOB-004 (the costed shop). |
| **D5** | v1 = "phase it" | v1 ships throwaway drafts + regenerate-WHOLE-plan + explicit Save/Discard (**NO per-meal lock**). D3's lock/partial-regen is v2. | De-risk: ship the value early; defer the stateful lock. |
| **D6** | Dietary = explicit settings only (v1) | The "derived from behaviour" idea depends on unbuilt Part B analytics — explicitly OUT of scope. | See `IDEAS.md` IDEA-005 Part B (not started, owner-gated). |
| **D7** | Cost objective | **"Cheapest weekly shop, prefer discounts": minimise total € to feed the week; use discounted items when they are the cheapest way.** | See rejected alternatives below. |
| **D8** | Roadmap | **SPIKE → v1 (no lock) → v2 (lock).** SPIKE the basket→real-recipe search FIRST (highest uncertainty). | Riskiest-assumption-first (Maurya). |

### D7 rejected alternatives (recorded verbatim per review Dimension 5 Q2)

| Rejected objective | Why rejected |
|--------------------|--------------|
| **Max discount COUNT** (use as many deals as possible) | Over-buying deals isn't saving — buying more discounted items than the week needs raises spend. |
| **Max € SAVED vs regular** (maximise regular−sale delta) | Can RAISE total spend: a €10 item at 50% off "saves €10" but costs €10; a €2 item you actually need is cheaper. Maximising saved-vs-regular optimises the wrong number. |
| **Chosen: minimise total € to feed the week, preferring discounts where cheapest** | Directly denominated in the JOB-004 outcome (what the shop costs); discounts are a means, not the target. |

---

## Wave: DISCUSS / [REF] Changed Assumptions

Recording where a prior assumption changes (DISCOVER docs untouched; recorded here per protocol).

| Prior (verified in code) | New (this feature) | Where |
|--------------------------|--------------------|-------|
| **Plans auto-save**; non-empty plan persisted on GET /plan and on generate; **1 plan/week frozen** (`plan-service.ts:171,192-194`) | **v1 plans are THROWAWAY DRAFTS until the user explicitly Saves** (D5). Regenerate replaces the WHOLE draft; Discard drops it; Save persists + prompts add-to-list (D4) | slice-01 |
| Meal name IS the discount item's name (`plan-service.ts:85`) | Meal name is a REAL recipe title; the recipe uses ≥1 discounted product (D1) | slice-01 |
| `estimatedSavings` = Σ over the whole basket (`plan-service.ts:47-49`) | Savings/spend computed over the **deduped set of discounted products actually used by the plan's meals** (D7); must not break the replace-on-save double-count guard | slice-03 |
| Recipe search keyed on ONE meal name (`recipe-query.ts`) | Search is BASKET-aware (built from the discounted products + dietary needs; LLM may build the query) (D1) | slice-00, slice-01 |

The list-centric spine (`grocery-expenditure-control.yaml`) already models the draft→experiment→save→
add-to-list intent at a coarse level (steps 4–5). This feature EXTENDS
`weekly-discount-meal-planning.yaml` (the SUPPORTING meal-planning flow) with the draft lifecycle via an
additive changelog — no second journey (avoids SSOT duplication).

---

## Wave: DISCUSS / [REF] Scope Assessment (Elephant Carpaccio Gate — run EARLY)

**Verdict: OVERSIZED → SPLIT into 6 value slices (1 SPIKE + 5) + 1 linked Technical Task, each ≤1 day.**

> slice-01 is committed to a 2-part split (01a draft lifecycle / 01b real-recipe generation) — it would
> otherwise ship ≥4 components (owner's 4+-component rule). The archive work (TECH-MPE-06) is a
> **Technical Task delivered inside slice-01's persistence work**, NOT a standalone value-slice (its only
> story is `infrastructure-only`; a standalone all-infrastructure slice has no release value —
> Dimension 0.5). So the value-slice spine is: S00 SPIKE → S01a/S01b → S03 → S02 → S04 → S05(v2).

| Oversized signal | Present? | Detail |
|------------------|----------|--------|
| >10 user stories if whole | YES | basket-search, draft model, real-recipe generation, list-source, cost objective, add-to-list, per-meal lock+partial regen+cross-source stickiness, archiving |
| Multiple independent user outcomes shippable separately | YES | "real recipes from my deals", "plan from my list", "cheapest plan", "save→shop", "keep the meals I like", "old plans don't clutter" are separable |
| Walking skeleton needed >5 integration points | NO | Brownfield; app ships end-to-end; new engine rides existing generation + recipe + list surfaces |
| Estimated effort >2 weeks | YES (as one lump) | Split makes each ≤1 day |
| >3 bounded contexts | Borderline | meal-planning (core), recipe (reused/extended), shopping-list (reused), preferences (dietary), llm (optional query) — reuse-heavy, not new contexts |

**Action**: 6 value slices (SPIKE first, D8; S01 split 01a/01b) + 1 linked Technical Task, ordered by
learning-leverage + dependency. Briefs at `docs/feature/meal-plan-engine/slices/slice-NN-*.md`
(slice-06 is a technical-task brief).

### Carpaccio taste tests (per slice)

| Test | 00 SPIKE | 01a/01b v1 core | 02 list-source | 03 cost | 04 save→list | 05 v2 lock | TECH-06 archive |
|------|----------|-----------|----------------|---------|--------------|-----------|-----------|
| ≤1 day? | Yes (timeboxed) | Yes (each ≤1d) | Yes | Yes | Yes | Yes | Yes (in S01) |
| End-to-end user-visible behaviour? | N/A (Spike) | Yes | Yes | Yes | Yes | Yes | N/A (tech task) |
| Independently demoable? | Yes (finding) | Yes | Yes (on 01) | Yes (on 01) | Yes (on 01) | Yes (on 01) | N/A |
| Delivers value alone? | Yes (kill/go) | Yes (KEYSTONE) | Yes | Yes | Yes | Yes | No — infra, linked to S01 |
| ≥1 user-visible story (not all @infrastructure)? | **N/A — Spike task type** | Yes | Yes | Yes | Yes | Yes | **N/A — Technical Task, delivered in S01 (not a standalone slice)** |

> **Spike note (pre-empts review Dimension 0.5)**: slice-00 is a **Spike task type** (time-boxed
> research, fixed duration, explicit disproof condition), NOT a user story slice. The Elevator-Pitch
> mandate and the "≥1 non-`@infrastructure` story per slice" rule apply only to value-slices (01–06),
> not to the Spike. A mechanical reviewer must treat slice-00 as a Spike, not BLOCK it for lacking a
> user-visible story.

---

## Wave: DISCUSS / [REF] Journey (extend the SUPPORTING meal-planning flow)

The meal-plan engine lives on the SUPPORTING journey `weekly-discount-meal-planning.yaml` (extended
additively — draft lifecycle). The list-centric PRIMARY spine (`grocery-expenditure-control.yaml`) is
unchanged; D4's add-to-list closes the loop back onto it.

```
[Trigger source]     [Generate DRAFT]      [Experiment]        [Save / Discard]     [Add to list]*
 feed selection       real recipes from     regenerate WHOLE     explicit Save        D4 prompt →
 (or all discounts)   the basket, each      draft (v1) /         persists;            add plan's
 OR list items        meal cost-aware       keep accepted (v2)   Discard drops        discounts to /list
 (D2)                 (D1,D7)                                                          (closes JOB-004 loop)
      |                    |                     |                    |                    |
   pick / land          curious              experimenting         decisive             in control
      ↓                    ↓                    ↓                    ↓                    ↓
   oriented             hopeful               converging           satisfied            loop closed

   * D4 add-to-list — supporting flow onto the PRIMARY list spine.
```

**Emotional arc**: curious (what can I cook from these deals?) → hopeful (real recipes, cost-aware) →
converging (regenerate until it fits) → satisfied/in-control (saved, shop cost known). No jarring
transitions: each regenerate is a low-cost experiment (throwaway draft — nothing committed until Save).

**Critical error paths** (feed into DISTILL error scenarios):
1. SPIKE-negative basket (no real recipe uses ≥2 discounted products dietary-compatibly) → fall back to
   fewer-product or single-product recipes; never invent a recipe (D1).
2. Zero recipes for the whole basket → draft shows "couldn't build meals from these — try a different
   selection"; never a fabricated meal.
3. A recipe would violate the dietary restriction → excluded (JOB-003); if all excluded, empty-with-reason.
4. Recipe source dead → shipped cached/fallback path (`recipe-service.ts:65-70`).
5. Draft lost on navigation (server-side state failure) → surfaced, not silently dropped.
6. Discount used by a saved plan expires mid-week → captured price persists (write-once, mirrors D-PO-10).

---

## Wave: DISCUSS / [REF] Story Map (backbone + slices)

### Backbone (user activities, left → right)

| Trigger the plan | Get real meals | Make it cheapest | Commit the plan | Close the loop |
|------------------|----------------|------------------|-----------------|--------------|
| From feed selection (S01) | Real recipe per meal (S01) | Cost-minimising selection (S03) | Save / Discard draft (S01) | Add discounts to list (S04) |
| From all discounts (S01) | Basket-aware search (S00→S01) | Prefer discounts where cheapest (S03) | Regenerate whole draft (S01) | Keep accepted meals (S05, v2) |
| From the shopping list (S02) | Dietary-safe recipes (S01) | Deduped spend/savings (S03) | | |

> Plan-storage archiving (TECH-MPE-06) is a linked Technical Task inside S01's persistence work — not a
> backbone activity (it is not user-facing; `/plan` already shows only the current week).

### Walking skeleton

**None** — brownfield. The app ships an end-to-end discount→plan→savings flow. slice-01 replaces the
placeholder generation core in place; it is the highest-leverage increment, not a skeleton.

### Priority Rationale (learning-leverage + dependency; not effort-first)

| # | Slice | One-line goal | Value×Urgency/Effort | Rationale |
|---|-------|---------------|----------------------|-----------|
| 1 | **S00 SPIKE** | Can a basket of N discounted products + a dietary need return a REAL recipe using ≥2 of them? | risk-gate | D8: highest uncertainty; disproves the whole feature cheaply if it fails. Validates D1 + whether LLM query-building helps. |
| 2a | **S01a** draft lifecycle | Throwaway DRAFT + regenerate-WHOLE + Save/Discard (meals still round-robin) | 5×5/2 ≈ 12.5 | KEYSTONE part 1. **NOT gated on S00** — the lifecycle is independent of recipe feasibility, so it can proceed regardless of the spike outcome. Server-side draft state. |
| 2b | **S01b** real-recipe generation | Replace round-robin with real basket-recipes (dietary-safe) | 5×5/3 ≈ 8.3 | KEYSTONE part 2. **Gated on S00 GO** — this is the part the spike de-risks. The real engine. |
| 3 | **S03** cost objective | Selection minimises total € to feed the week, preferring discounts (D7) | 5×4/3 ≈ 6.7 | The JOB-004 outcome. Rides S01b's engine; changes the product-selection step. |
| 4 | **S02** list-source | Shopping-list page as contextual source (D2) | 4×3/2 = 6 | Extends the trigger; wires to shipped `/list`. Independent value (plan from what I'll buy). |
| 5 | **S04** save→list | Save prompts add-plan-discounts-to-list (D4) | 4×3/2 = 6 | Closes the JOB-004 loop; wires to shipped `POST /list/add`. Depends on S01a's Save. |
| 6 | **S05** v2 lock | Per-meal accept + partial regenerate + cross-source stickiness (D3) | 4×4/4 = 4 | Deferred by D5/D8; needs S01+S02. Highest state complexity. |
| — | **TECH-MPE-06** | Archive expired plans (mirror `offer_history`) — Technical Task | infra | Delivered inside S01's persistence work; not a standalone value-slice (its only story is infrastructure-only). |

**Dependency asymmetry at the S01 seam (why the split de-risks)**: S01a (draft lifecycle: server-side
draft state, Save/Discard/Regenerate over round-robin meals) has NO dependency on the SPIKE — it can be
built in parallel with / regardless of slice-00. Only S01b (real basket-recipe generation) is gated on
slice-00's GO. Splitting means a NO-GO or partial spike result reshapes S01b without stalling S01a.

Tie-break: S00 first (riskiest assumption). S01a/S01b outrank the cheaper S02/S04 (KEYSTONE). S03 before
S02/S04 because the cost objective is the JOB-004 outcome the whole reframe exists to serve.

---

## Wave: DISCUSS / [REF] System Constraints (cross-cutting)

- **Reuse over rebuild** (SSOT/DRY): extend the shipped Chefkoch source + `RecipeService` cache; reuse
  the live `ShoppingListService` / `POST /list/add` for D2/D4; reuse the `LlmTextGenerator` port for
  optional query-building. No parallel artifacts.
- **Dietary safety (JOB-003) is a hard gate**, not a filter-after: no recipe that violates the
  restriction may ever surface (D1). NEVER an LLM-invented recipe.
- **Single source for savings**: plan savings/spend reuse `regular_price − sale_price` from the same
  `discount_items` rows the shipped savings tracker reads; no divergent number.
- **Replace-on-save double-count guard must survive** (`plan-service.ts:100-118`): the new
  multi-product-per-meal savings must be computed over the DEDUPED used-product set so a product used by
  two meals is not counted twice, and `savings_log` is not double-written.
- **No regression**: shipped discount→plan→savings flow, `/list`, `data-*` acceptance-suite assertions,
  375px layout, green suite must all survive.
- **XSS**: recipe titles + user-typed manual items route through `escapeHtml` (`src/shared/html.ts`).
- **Single-user / local**: no auth; "household" = whose budget.

---

## Wave: DISCUSS / [REF] Driving Ports (inbound surfaces)

Existing (reused, may change payload): `GET /`, `GET /plan`, `POST /plan/generate`,
`GET /plan/{day}-{slot}`, `GET /list`, `POST /list/add`, `POST /list/remove`, `GET /savings`,
`GET|POST /settings`.

New/likely (solution-neutral — exact routes are a DESIGN decision):
- draft lifecycle actions (S01) — e.g. `POST /plan/regenerate`, `POST /plan/save`, `POST /plan/discard`
- list-sourced generation (S02) — e.g. `POST /plan/generate?from=list`
- per-meal accept + partial regenerate (S05, v2) — e.g. `POST /plan/meal/{id}/accept`

---

## Wave: DISCUSS / [REF] User Stories with Elevator Pitches

> Right-sized note: each story has 3–7 UAT scenarios and ≤1-day effort per its slice. `job_id` on every
> story. Real Munich data (Rote Linsen €1.19, Mozzarella €0.69, Campari Tomaten €1.29, Vollmilch €1.09).

---

### US-MPE-01: Generate a throwaway meal-plan draft of real recipes from my deals

**job_id**: `JOB-001` · **parent**: JOB-004 · **Slice**: S01 · **MoSCoW**: Must Have · **Depends on**: S00 finding

#### Problem
When Dimitar generates a "meal plan" today, each meal is just a discounted product's name pasted into a
slot (round-robin) — "Mozzarella 125g" is a meal. There is no recipe, so the plan tells him nothing
about what to actually cook, and every generate immediately overwrites and auto-saves the week's plan, so
he cannot experiment.

#### Who
- Dimitar Apostolov | picked some cheap deals on the feed, wants meal ideas | Wants real recipes built
  from those deals, and the freedom to regenerate until happy before committing.

#### Elevator Pitch
- **Before**: on `/plan`, meals are bare discount-item names (round-robin), the plan auto-saves, no recipe.
- **After**: select deals on `http://localhost/`, tap "Generate meal plan" → `/plan` shows a DRAFT where
  each meal is a real recipe title (e.g. "Rote Linsen-Dal") linking to its source and showing which
  discounted product(s) it uses; "Regenerate" rebuilds the whole draft, "Save"/"Discard" commit or drop it.
- **Decision enabled**: Dimitar decides which meals to actually cook this week — and whether to keep this
  plan — from real, dietary-safe recipes grounded in his deals, without a half-baked plan being saved.

#### Domain Examples
1. **Happy path**: Dimitar selects Rote Linsen (Aldi €1.19), Campari Tomaten (Edeka €1.29), Mozzarella
   (Aldi €0.69). Generates → a draft of real vegetarian recipes: "Rote Linsen-Tomaten-Dal" (uses Rote
   Linsen + Campari Tomaten), "Caprese Salat" (uses Mozzarella + Campari Tomaten). Each links to Chefkoch.
2. **Regenerate whole draft**: unhappy with the draft, taps "Regenerate" → a DIFFERENT set of real
   recipes from the same deals. Nothing was saved; the previous week's saved plan (if any) is untouched.
3. **Discard**: taps "Discard" → the draft is gone, `/plan` shows the last saved plan (or the empty state).

#### UAT Scenarios (BDD)
```gherkin
Scenario: Generating a draft produces real recipes built from the selected deals
  Given Dimitar selected Rote Linsen, Campari Tomaten and Mozzarella from the feed
  When he taps "Generate meal plan"
  Then a draft plan is shown where each meal is a real recipe title linking to its source
  And each meal names the discounted product(s) it uses
  And no meal is merely a raw discount-item name

Scenario: Every drafted recipe respects the vegetarian restriction
  Given Dimitar's dietary restriction is "vegetarian"
  When a draft is generated from a selection that includes meat and vegetarian deals
  Then no drafted recipe contains meat or fish

Scenario: The draft is not saved until Dimitar chooses to save it
  Given a saved plan exists for this week
  When Dimitar generates a new draft and does not save it
  Then the saved plan for the week is unchanged
  And no savings row is written for the draft

Scenario: Regenerate rebuilds the whole draft
  Given Dimitar is viewing a draft plan
  When he taps "Regenerate"
  Then a new draft of real recipes from the same deals is shown
  And nothing has been persisted

Scenario: Discard drops the draft without side effects
  Given Dimitar is viewing an unsaved draft
  When he taps "Discard"
  Then the draft is removed
  And the last saved plan (or the empty state) is shown

Scenario: No real recipe can be built from the selection
  Given a selection for which no real dietary-safe recipe can be found
  When Dimitar generates
  Then the draft shows "Couldn't build meals from these — try a different selection"
  And no meal is fabricated
```

#### Acceptance Criteria
- [ ] Each drafted meal is a REAL recipe (title + source link), sourced via the shipped Chefkoch source (reused/extended), never an LLM-invented recipe, never a bare discount-item name.
- [ ] Each meal names the discounted product(s) it uses.
- [ ] No drafted recipe violates the dietary restriction (JOB-003).
- [ ] Generation produces a DRAFT that is NOT persisted; the existing saved plan and `savings_log` are untouched until Save.
- [ ] "Regenerate" rebuilds the whole draft from the same source; "Save" persists; "Discard" drops it.
- [ ] No-recipe-found shows an explicit empty-with-reason state; no fabricated meals.

#### Outcome KPIs
- **Who**: Dimitar
- **Does what**: Gets real, cookable, dietary-safe recipes built from his deals (not raw item names)
- **By how much**: A real recipe is found for **≥70% of plan meals** (currently 0% — meals are item names)
- **Measured by**: Rendered `/plan` draft — count of meals with a resolved recipe ÷ total meals
- **Baseline**: 0% recipe coverage (round-robin item names)

#### Technical Notes
- Extends shipped `RecipeService`/`ChefkochRecipeSource` (cache-first 7d TTL) and the basket-aware search from S00. Replaces `buildMealSlot` round-robin (`plan-service.ts:75-86`).
- **Draft lifecycle needs SERVER-SIDE draft state** — see Architectural Flags (server-rendered, no client session). Flag for DESIGN; do NOT design here.
- Reuses `DEFAULT_MEAL_TYPES`/slot model; `job_id`: JOB-001.

---

### US-MPE-02: Generate a plan from what's on my shopping list

**job_id**: `JOB-001` · **parent**: JOB-004 · **Slice**: S02 · **MoSCoW**: Should Have · **Depends on**: US-MPE-01

#### Problem
Dimitar has assembled his shopping list for the week (deals + staples). He wants meal ideas for exactly
those items, but generation only ever reads the feed selection — there is no way to say "plan meals from
what I'm actually buying."

#### Who
- Dimitar Apostolov | standing on the `/list` page with his week's shop assembled | Wants a plan built
  from the list's items, not the feed.

#### Elevator Pitch
- **Before**: meal-plan generation always reads the feed selection; the shopping list can't drive it.
- **After**: on `http://localhost/list`, tap "Generate meal plan from this list" → `/plan` shows a draft
  whose recipes are built from the list's discounted items.
- **Decision enabled**: Dimitar decides what to cook from the exact shop he's committed to — the plan and
  the list agree.

#### Domain Examples
1. **From the list**: Dimitar's list has Rote Linsen, Campari Tomaten, Basmati Reis (all discounted). He
   generates from the list → recipes built from those three (e.g. "Linsen-Reis-Curry").
2. **Contextual source (D2)**: on the FEED he generates → feed selection is the source; on the LIST he
   generates → the list is the source. Same button semantics, source follows location.
3. **Empty list**: generating from an empty list shows "Your list is empty — add items first" (never a
   fabricated plan).

#### UAT Scenarios (BDD)
```gherkin
Scenario: Generating from the shopping list uses the list's items as the source
  Given Dimitar's shopping list contains Rote Linsen, Campari Tomaten and Basmati Reis
  When he taps "Generate meal plan from this list" on the list page
  Then a draft plan is shown whose recipes are built from those list items

Scenario: The generation source follows the trigger location
  Given Dimitar is on the shopping-list page
  When he generates a plan
  Then the list items are the source, not the feed selection

Scenario: Generating from an empty list is explained, not fabricated
  Given Dimitar's shopping list is empty
  When he attempts to generate a plan from the list
  Then he sees "Your list is empty — add items first"
  And no plan is generated
```

#### Acceptance Criteria
- [ ] The shopping-list page offers a "generate plan from this list" action.
- [ ] When triggered from the list, the plan's source is the list's discounted items (D2); when triggered from the feed, the source is the feed selection (or all discounts if none selected).
- [ ] Generating from an empty list shows an explanatory empty state; no plan is produced.
- [ ] Reuses `ShoppingListService.getCurrentList()` for the source items (no new list read model).

#### Outcome KPIs
- **Who**: Dimitar
- **Does what**: Generates a plan from the exact shop he'll buy
- **By how much**: List-sourced generation available from `/list` in 1 action (currently impossible: 0)
- **Measured by**: `/list` renders a generate action; plan source == list items
- **Baseline**: 0 — generation reads only the feed selection

#### Technical Notes
- Wires to shipped `ShoppingListService`/`GET /list` (`shopping-list-service.ts:86`). Source-selection is the only new logic. `job_id`: JOB-001.

---

### US-MPE-03: Build the plan that makes the weekly shop cheapest

**job_id**: `JOB-001` · **parent**: JOB-004 · **Slice**: S03 · **MoSCoW**: Must Have · **Depends on**: US-MPE-01

#### Problem
Even with real recipes, a plan can quietly cost more than it should — picking pricey deals or buying more
discounted items than the week needs. Dimitar's actual goal (JOB-004) is the cheapest weekly shop, with
discounts as the means, not the target.

#### Who
- Dimitar Apostolov | wants the plan to minimise what the week's food costs | Cares about total € spent,
  not how many deals or how much "saved-vs-regular" the plan racks up.

#### Elevator Pitch
- **Before**: the plan just uses whatever deals were selected, in round-robin order — no cost objective.
- **After**: on `/plan`, the drafted plan is assembled to **minimise total € to feed the week, preferring
  discounted products where they are the cheapest way**, and the plan footer shows the plan's total spend
  and its saving vs an all-regular-price baseline.
- **Decision enabled**: Dimitar decides against the true cost — he sees the plan is the cheapest way to
  eat this week, not just a pile of deals.

#### Domain Examples
1. **Cheapest wins**: Two vegetarian recipes could fill a slot — one needs a €2.49 Gouda deal, one needs
   a €0.69 Mozzarella deal for the same role. The engine picks the Mozzarella recipe (lower total €).
2. **Not max-count**: 12 deals are selected but the week only needs 8 products to cover 14 meals; the plan
   does NOT force all 12 in just to maximise discount count (over-buying isn't saving — D7).
3. **Deduped savings**: Campari Tomaten is used by two recipes; the plan's spend and savings count that
   product's price ONCE, not twice.

#### UAT Scenarios (BDD)
```gherkin
Scenario: The plan minimises total spend, preferring discounts where cheapest
  Given two candidate recipes can fill the same slot using different discounted products
  When the plan is generated
  Then the recipe leading to the lower total weekly spend is chosen

Scenario: The plan does not over-buy deals to inflate discount count
  Given more discounted products are selected than the week's meals require
  When the plan is generated
  Then the plan uses only the products needed to cover the meals
  And it does not add products solely to raise the discount count

Scenario: Spend and savings count a shared product only once
  Given a discounted product is used by two meals in the plan
  When the plan's total spend and saving are computed
  Then that product's price is counted once, not twice

Scenario: The plan shows its spend against an all-regular-price baseline
  Given a generated plan using discounted products
  When Dimitar views the plan
  Then the plan shows its total spend and the saving versus buying the same products at regular price
  And this saving matches the shipped savings computation for the deduped used products
```

#### Acceptance Criteria
- [ ] Product selection minimises total € to feed the week, preferring discounted products where they are the cheapest option (D7) — NOT max discount-count, NOT max €-saved-vs-regular.
- [ ] The plan uses only the products the meals need; surplus selected deals are not force-included.
- [ ] Spend and savings are computed over the DEDUPED set of used discounted products (a product used by N meals counts once).
- [ ] The deduped savings equals the shipped `regular_price − sale_price` computation for the same rows (single source); the replace-on-save double-count guard is not broken.
- [ ] The plan footer shows total spend and saving vs an all-regular-price baseline.

#### Outcome KPIs
- **Who**: Dimitar (household)
- **Does what**: Gets the plan that costs the least to feed the week, using discounts as the means
- **By how much**: **≥80% of plan meals use ≥1 discounted product**; plan spend is **≤ the all-regular-price baseline** for the same products every week
- **Measured by**: `meal_plans` snapshot — meals-using-a-discount ÷ total; plan spend vs Σ regular_price of used products
- **Baseline**: today savings = Σ over whole basket regardless of what 14 meals show (`plan-service.ts:47-49`); no per-plan cost objective

#### Technical Notes
- Changes the product-selection + savings computation, NOT the recipe source. **Multi-product-per-meal savings must dedup** and preserve the double-count guard (`plan-service.ts:100-118`) — flag as a DESIGN constraint. `job_id`: JOB-001.

---

### US-MPE-04: When I save a plan, offer to add its deals to my shopping list

**job_id**: `JOB-001` · **parent**: JOB-004 · **Slice**: S04 · **MoSCoW**: Should Have · **Depends on**: US-MPE-01; shipped `POST /list/add`

#### Problem
Dimitar saves a plan he likes, then has to separately re-add each discounted product to his shopping
list to actually buy them. The plan and the shop don't connect — the JOB-004 loop stays open.

#### Who
- Dimitar Apostolov | just saved a plan he's happy with | Wants its discounted products on his shopping
  list without re-picking them.

#### Elevator Pitch
- **Before**: saving a plan does nothing for the shopping list; Dimitar re-adds each deal by hand.
- **After**: on Save, a prompt asks "Add this plan's discounted items to your shopping list?" → Yes adds
  them to `/list` (running total updates); No just saves the plan.
- **Decision enabled**: Dimitar decides in one step to turn the plan he chose into the shop he'll buy —
  closing the loop to knowing the shop's cost (JOB-004).

#### Domain Examples
1. **Add on save**: Dimitar saves a plan using Rote Linsen, Campari Tomaten, Mozzarella; accepts the
   prompt → all three land on `/list`, total rises by €3.17.
2. **Decline**: he saves but taps "No" → the plan is saved, the list is unchanged.
3. **Already-on-list (dedup)**: Campari Tomaten is already on his list; accepting the prompt does not add
   a duplicate row (increments quantity, per the shipped list semantics).

#### UAT Scenarios (BDD)
```gherkin
Scenario: Saving a plan offers to add its discounted items to the list
  Given Dimitar has a draft plan using Rote Linsen, Campari Tomaten and Mozzarella
  When he saves the plan
  Then he is asked whether to add the plan's discounted items to his shopping list

Scenario: Accepting adds the plan's deals to the shopping list
  Given the add-to-list prompt is shown after saving
  When Dimitar accepts
  Then the plan's discounted products appear on his shopping list
  And the list running total increases accordingly

Scenario: Declining saves the plan without touching the list
  Given the add-to-list prompt is shown after saving
  When Dimitar declines
  Then the plan is saved
  And the shopping list is unchanged

Scenario: A product already on the list is not duplicated
  Given Campari Tomaten is already on Dimitar's list
  When he accepts the add-to-list prompt for a plan that also uses Campari Tomaten
  Then no duplicate row is created for Campari Tomaten
```

#### Acceptance Criteria
- [ ] Saving a plan shows a prompt to add its discounted products to the shopping list.
- [ ] Accepting adds them via the shipped `ShoppingListService.addFromDiscountSelection` / `POST /list/add`; the running total updates.
- [ ] Declining saves the plan and leaves the list unchanged.
- [ ] Products already on the list are not duplicated (reuses shipped add semantics).

#### Outcome KPIs
- **Who**: Dimitar
- **Does what**: Turns a saved plan into the shop's items in one step
- **By how much**: Plan deals reach the list in **1 action on save** (currently: manual re-add, 0)
- **Measured by**: add-to-list-on-save prompt present; list gains the plan's discount rows on accept
- **Baseline**: 0 — no connection between save and list

#### Technical Notes
- Pure wiring to shipped `POST /list/add` (`shopping-list-handler.ts:129,146-161`) / `addFromDiscountSelection` (`shopping-list-service.ts:39`). **D2/D4 interaction flag**: when the source WAS the list (US-MPE-02), the add-to-list prompt is a near no-op — see Architectural Flags. `job_id`: JOB-001.

---

### US-MPE-05 (v2): Keep the meals I like when I regenerate

**job_id**: `JOB-001` · **parent**: JOB-004 · **Slice**: S05 · **MoSCoW**: Could Have (v2, deferred by D5/D8) · **Depends on**: US-MPE-01, US-MPE-02

#### Problem
In v1, regenerate replaces the WHOLE draft — so a meal Dimitar loved is lost when he regenerates to fix
the ones he didn't. He wants to keep the good meals and only reroll the rest.

#### Who
- Dimitar Apostolov | happy with 3 of 6 drafted meals | Wants to lock those 3 and regenerate only the
  other 3, even if he switches the source from list to feed.

#### Elevator Pitch
- **Before**: regenerate rerolls everything; accepted-feeling meals are lost on each reroll.
- **After**: on `/plan`, mark individual meals "accepted"; "Regenerate" replaces only the un-accepted
  meals; accepted meals persist across regenerations AND across a source switch (accept on a list-based
  plan, go to the feed, regenerate → the accepted meals survive, the rest reroll).
- **Decision enabled**: Dimitar converges on the plan he wants iteratively, without re-earning the meals
  he already liked.

#### Domain Examples
1. **Partial reroll**: accepts "Rote Linsen-Dal" and "Caprese Salat"; regenerates → those two stay, the
   other four are replaced with new real recipes.
2. **Cross-source stickiness (D3)**: accepts two meals on a LIST-sourced plan, switches to the FEED,
   regenerates → the two accepted meals survive; the rest reroll from the feed selection.
3. **Accept then save**: accepts all meals, saves → the saved plan is exactly the accepted set.

#### UAT Scenarios (BDD)
```gherkin
Scenario: Regenerate replaces only the un-accepted meals
  Given a draft where Dimitar has accepted two of six meals
  When he taps "Regenerate"
  Then the two accepted meals are unchanged
  And the other four meals are replaced with new real recipes

Scenario: Accepted meals survive a source switch
  Given Dimitar accepted two meals on a list-sourced draft
  When he switches to the feed and regenerates
  Then the two accepted meals remain in the draft
  And the remaining meals are regenerated from the feed selection

Scenario: Accepting all meals then saving persists exactly those meals
  Given Dimitar accepted every meal in a draft
  When he saves the plan
  Then the saved plan contains exactly the accepted meals
```

#### Acceptance Criteria
- [ ] A meal can be marked "accepted" individually in the draft.
- [ ] "Regenerate" replaces only un-accepted meals; accepted meals are preserved verbatim.
- [ ] Accepted meals persist across regenerations and across a source switch (feed ↔ list) — D3.
- [ ] Saving persists exactly the current draft (accepted + last-regenerated) meals.

#### Outcome KPIs
- **Who**: Dimitar
- **Does what**: Converges on a plan by keeping good meals and rerolling the rest
- **By how much**: Accepted meals retained across **100% of regenerations and source switches** (v1: 0% — whole-draft reroll)
- **Measured by**: draft state — accepted meals unchanged after regenerate / source switch
- **Baseline**: 0 — v1 rerolls the whole draft

#### Technical Notes
- Requires per-meal accepted state in the server-side draft (extends the S01 draft-state flag). Highest state complexity — deferred to v2 by D5/D8. `job_id`: JOB-001.

---

### TECH-MPE-06 (Technical Task): archive expired plans for bounded storage + provenance

**Type**: Technical Task (NOT a user story — no Elevator Pitch, no user-facing value on its own)
**job_id**: `infrastructure-only` · **infrastructure_rationale**: Storage hygiene + history retention.
It enables no standalone user decision, so no Elevator Pitch (Dimension 0.5). It is a Technical Task
linked to the plan persistence introduced in slice-01, delivered inside that value slice's DELIVER work
— NOT a standalone value-slice. · **Enables**: IDEA-005 Part B analytics (longitudinal plan history).

> **Corrected premise (verified against code)**: `/plan` already surfaces ONLY the current week —
> `getOrGenerateCurrentWeekPlan` reads `findByWeek(currentWeekMonday())` and `getCurrentWeekPlan` does
> the same (`src/meal-planning/plan-service.ts:127-129,177`). Expired plans linger **in storage**, never
> in the view. So there is NO user-facing "clutter" problem — the earlier framing was wrong. The real
> value is bounded storage growth + preserving history for later analytics; that is infrastructure, so
> this is a Technical Task, not a user story. (Flagged in the report per the mandate.)

#### Problem (technical)
Saved weekly plans accumulate in storage keyed by week with no lifecycle (`plan-service.ts` has no
archiving), mirroring the pre-`offer_history` discount problem. History is also lost to overwrite on
resave (replace-on-save wipes the prior week's row before analytics can use it).

#### Acceptance Criteria
- [ ] On week rollover / plan replace, expired saved plans are ARCHIVED (not deleted), preserving original week + `created_at`, mirroring the shipped `offer_history` archive-on-replace pattern (IDEA-005 Part A, commit `aa49ff7`): archive `INSERT ... SELECT` as the first statement inside the transaction, before the delete — atomic.
- [ ] The replace-on-save double-count guard (`plan-service.ts:100-118`) is unaffected.
- [ ] No change to the current plan view (it already shows only the current week — verified above).

#### Technical Notes
- Mirror `SQLiteDiscountItemRepository.replaceStore`. Composes with write-once price capture (a saved
  plan keeps its captured prices after the discount expires). `job_id`: `infrastructure-only`. Delivered
  within slice-01's persistence work (linked technical task), not as an independent value-slice.

---

## Wave: DISCUSS / [REF] Architectural Flags (OPEN for DESIGN — do NOT design here)

1. **Server-side draft state (attaches at slice-01, not only v2).** Throwaway drafts must survive the
   generate→regenerate→Save gap AND (in v2) stay sticky across page navigation (D3). The app is
   server-rendered HTML with no SPA/client session — so a draft cannot live only in the browser. This
   implies **server-side draft state** (a draft table, or a single-user draft singleton). v1 (S01)
   already needs it for regenerate-then-save; v2 (S05) extends it with per-meal accepted state and
   cross-source persistence. **Flag for DESIGN — do not choose the mechanism here.**
2. **Multi-product-per-meal savings/spend computation.** New recipes may use MULTIPLE discounted
   products per meal, and a product may recur across meals → the savings/spend computation must DEDUP the
   used-product set (count each product once) and must NOT break the existing `savings_log` double-count
   guard / replace-on-save atomicity (`plan-service.ts:100-118`). **Flag as a DESIGN constraint.**

---

## Wave: DISCUSS / [REF] Internal Inconsistencies in the Locked Decisions (flagged, not resolved)

Per the report mandate — surfaced, not silently resolved:

1. **Server-side draft state is attributed to D3 (v2) in the brief, but v1 needs it too.** D5's v1
   throwaway draft must persist across regenerate and until an explicit Save, and the app has no client
   session — so the server-side-state flag attaches at slice-01, not only slice-05. Recorded above
   (Architectural Flag 1); the *mechanism* is left to DESIGN.
2. **D2 + D4 interact awkwardly (lower confidence).** When the generation SOURCE is the shopping list
   (D2, US-MPE-02), the plan is built from items already on the list; D4 then prompts to add the plan's
   discounted items back to the list they came from — a near no-op / pure dedup case. Not resolved here;
   noted so DESIGN handles it (dedup on add; possibly suppress the prompt when source == list). Connects
   to the shipped add-dedup semantics.
3. **Brief's slice-06 "auto-archive expired plans" was framed as a value slice with a user-facing
   benefit, but the code contradicts that.** `/plan` already surfaces only the current week
   (`getOrGenerateCurrentWeekPlan`/`getCurrentWeekPlan` → `findByWeek(currentWeekMonday())`,
   `plan-service.ts:127-129,177`) — expired plans linger in storage, never in the view, so there is no
   "clutter" the user experiences. RESOLVED (not silently): reclassified as **TECH-MPE-06, a Technical
   Task** (storage hygiene + provenance for IDEA-005 Part B) delivered inside slice-01's persistence work,
   not a standalone value-slice (a standalone all-infrastructure slice would be BLOCKED by review
   Dimension 0.5). The archive mechanism still mirrors `offer_history` exactly as the brief asked.

---

## Wave: DISCUSS / [REF] Outcome KPIs Summary (spend/savings-denominated per the framing)

### Feature Objective
Turn the weekly meal plan into the cheapest way to feed the household from this week's discounts —
real, dietary-safe recipes built from the deals, assembled to minimise total spend, one step from the
shopping list. Success is denominated in **spend**, not recipe quality.

### KPI Table

| # | Who | Does What | By How Much | Baseline | Measured By | Type |
|---|-----|-----------|-------------|----------|-------------|------|
| 1 | Dimitar (household) | Keeps plan spend at/under an all-regular-price baseline | **Plan spend ≤ Σ regular_price of the same used products, every week** | today's savings = Σ over whole basket, not the shown meals (`plan-service.ts:47-49`) | `meal_plans`: plan spend vs Σ regular of deduped used products | Leading (North Star) |
| 2 | Dimitar (household) | Fills the plan with discounted products (means, not target) | **≥80% of plan meals use ≥1 discounted product** | ~round-robin coverage, uncontrolled | `meal_plans`: meals-using-a-discount ÷ total | Leading |
| 3 | Dimitar | Uses the breadth of this week's deals in the plan | **discounted-product coverage: ≥60% of selected deals appear in the plan** (without over-buying, D7) | n/a — no cost objective today | used discounted products ÷ selected discounted products | Secondary |
| 4 | Dimitar | Gets a real, cookable recipe per meal | **real recipe found for ≥70% of plan slots** | 0% (meals are item names) | `/plan` — resolved recipes ÷ meals | Leading (activation) |
| 5 | Dimitar (household) | Reduces monthly grocery spend (persona goal) | supports the persona's **20–30% monthly reduction** goal | untracked | `savings_log` monthly € trend | Lagging (impact) |

### Metric Hierarchy
- **North Star**: plan spend ≤ all-regular-price baseline for the used products (KPI 1) — the JOB-004 cost outcome.
- **Leading**: % of plan meals using ≥1 discounted product (KPI 2); real-recipe coverage (KPI 4).
- **Secondary**: discounted-product coverage (KPI 3).
- **Impact (lagging)**: monthly € spend reduction (KPI 5).
- **Guardrails (must NOT degrade)**: dietary safety = 100% (no meat/fish meal ever surfaces to a
  vegetarian); shipped acceptance suite green + `data-*` preserved; deduped savings == shipped savings
  tracker for the same rows; `savings_log` not double-counted; 375px + desktop layouts unregressed.

### Hypothesis
We believe that generating a plan of real, dietary-safe recipes assembled to minimise total spend from
this week's discounts will let Dimitar feed the household for less. We will know this is true when plan
spend stays at/under the all-regular-price baseline, ≥80% of plan meals use ≥1 discounted product, and a
real recipe is found for ≥70% of slots.

### Handoff to DEVOPS (instrumentation)
- Capture per plan: total spend, Σ regular_price of deduped used products, meals-using-a-discount count,
  resolved-recipe count, selected-vs-used discounted products.
- Guardrail alert: any vegetarian-violating recipe surfaced; deduped savings ≠ shipped tracker.
- Baseline: KPIs 1–4 have no baseline today — collect from the first weeks post-release.

---

## Wave: DISCUSS / [REF] Pre-requisites

- **slice-00 SPIKE must complete first (D8)** — its finding gates slice-01's feasibility (a negative
  result kills or reshapes the feature).
- Shipped stack live: `RecipeService`/`ChefkochRecipeSource`, `ShoppingListService`+`/list`,
  `LlmTextGenerator` port (`resolveLlm`), `discount_items` with `taxonomyCategory`, `offer_history`.
- No external prerequisites beyond the shipped stack (Bun/SQLite/Drizzle, optional LLM via env).

---

## Wave: DISCUSS / [REF] Out of Scope

- **LLM-invented recipes** — hard NO (D1); dietary-safety hazard. (LLM may build the *search query* only.)
- **Per-meal lock / partial regenerate / cross-source stickiness in v1** — deferred to v2 (D5, slice-05).
- **Dietary "derived from behaviour"** — depends on unbuilt IDEA-005 Part B analytics (D6).
- Kid-friendly / household-size / cooking-time as *generation* inputs (they shape the per-meal query
  only today) — separate concern (memory `preferences-model-split`).
- Multi-user / auth; new cities / stores; native mobile / PWA.

---

## Wave: DISCUSS / [REF] Wave Decisions Summary

- **Framing**: extend JOB-001 (meal planning, SUPPORTING) in service of JOB-004 (spend control,
  PRIMARY). No new job; additive `jobs.yaml` changelog only; every story `job_id: JOB-001` (parent
  JOB-004), dietary safety via JOB-003, savings display reuses JOB-002. Meal planning is NOT re-elevated.
- **Locked D1–D8** encoded verbatim; D7 rejected alternatives (max-count, max-€-saved) recorded with
  rationale.
- **Scope**: oversized → 6 value slices (SPIKE first (D8); S01 split 01a lifecycle / 01b real-recipe;
  cost; list-source; save→list; v2 lock) + 1 linked Technical Task (archive, delivered in S01). Priority
  by learning-leverage + dependency.
- **Reuse**: extend shipped Chefkoch/RecipeService; reuse `ShoppingListService`/`/list` for D2/D4; reuse
  `LlmTextGenerator` port for optional query-building; mirror `offer_history` for archiving.
- **Changed Assumptions**: plans auto-save/1-per-week-frozen → throwaway drafts until Save; meal name →
  real recipe title; whole-basket savings → deduped used-product savings; one-item search → basket-aware.
- **Architectural flags (OPEN for DESIGN)**: server-side draft state (attaches at v1, extends in v2);
  deduped multi-product-per-meal savings preserving the double-count guard.
- **SSOT updates**: additive `jobs.yaml` changelog; extend `weekly-discount-meal-planning.yaml` (draft
  lifecycle, additive changelog) — no second journey. DISCOVER docs untouched.

---

## Wave: DISCUSS / [REF] Definition of Ready (9-Item Checklist)

| # | Item | Status | Evidence |
|---|------|--------|----------|
| 1 | Problem statement clear, domain language | PASS | Each US Problem in Dimitar's terms (round-robin item-names, till-surprise, Angebot, vegetarian, household budget) |
| 2 | User/persona with specific characteristics | PASS | `dimitar` — vegetarian SWE, Munich, shared household budget; `personas/dimitar.yaml` |
| 3 | 3+ domain examples with real data | PASS | Every US has 3 examples with real Munich items/prices (Rote Linsen €1.19, Mozzarella €0.69, Campari Tomaten €1.29) |
| 4 | UAT in Given/When/Then (3–7 scenarios) | PASS | 3–6 scenarios per story; all Gherkin, business-outcome titles |
| 5 | AC derived from UAT | PASS | AC bullets per story, traceable to scenarios |
| 6 | Right-sized (≤1 day/slice, 3–7 scenarios) | PASS | 6 value slices ≤1d (S01 split 01a/01b); SPIKE time-boxed; archive is a linked Technical Task in S01 |
| 7 | Technical notes: constraints/dependencies | PASS | Per-story Technical Notes + System Constraints + Architectural Flags |
| 8 | Dependencies resolved or tracked | PASS | S01→S00; S02/S03/S05→S01; S04→shipped `/list`; deps table in each slice brief |
| 9 | Outcome KPIs with measurable targets | PASS | 5 KPIs — 2 spend-denominated (plan spend ≤ all-regular baseline; monthly € reduction) + 3 leading/secondary (≥80% meals use a discount; ≥60% discount coverage; ≥70% recipe coverage) + per-story KPIs, each with target + method + baseline |

### DoR Status: PASSED

> `job_id` gate: every value story (US-MPE-01…05) carries `job_id: JOB-001` (parent JOB-004);
> TECH-MPE-06 is `infrastructure-only` with an `infrastructure_rationale` and no Elevator Pitch (per
> Dimension 0.5) — reclassified from a value-slice to a Technical Task delivered inside slice-01 (its
> premise "expired plans clutter the view" was false: `/plan` already shows only the current week,
> `plan-service.ts:127-129,177`). slice-00 is a Spike task type (no user story). Every value-slice
> contains ≥1 non-`@infrastructure` user-visible story; no standalone all-infrastructure slice exists.

---

## Wave: DISCUSS / [REF] Requirements Completeness

**Completeness Score: 0.92**

| Dimension | Coverage | Notes |
|-----------|----------|-------|
| Locked decisions D1–D8 encoded | 8/8 | Verbatim table + D7 rejected alternatives |
| Current state verified against code | Yes | file:line citations; found shipped list BC + LLM port + offer_history |
| Jobs traced | JOB-001 (parent JOB-004), JOB-003 (dietary), JOB-002 (savings reuse) | additive changelog; no new job |
| Stories with Elevator Pitch | 5/5 value stories (US-MPE-01…05) | TECH-MPE-06 is a Technical Task, infrastructure-only (no pitch, by rule) |
| Error/edge paths | 6 | SPIKE-negative, zero-recipe, dietary-exclusion, dead source, lost draft, mid-week expiry |
| Architectural flags surfaced (not designed) | 2 | server-side draft state; deduped multi-product savings |
| Internal inconsistencies flagged | 2 | draft-state-at-v1 (corrected placement); D2+D4 no-op |

Deduction (−0.08): SPIKE outcome (D1 feasibility + LLM query-building value) is unresolved by design —
it is the whole point of slice-00; several downstream specifics (exact recipe coverage achievable,
whether LLM query-building helps) firm up only after the Spike.

---

## Wave: DISCUSS / [REF] Risks

| Risk | Prob | Impact | Mitigation |
|------|------|--------|------------|
| SPIKE fails: no basket→real-recipe search returns ≥2-product dietary-safe recipes | Med | High | slice-00 first (D8); disproof condition explicit; degrade path = fewer-product recipes; never invent (D1) |
| Multi-product savings breaks the `savings_log` double-count guard | Med | High | Architectural Flag 2 + AC pins deduped==shipped-tracker; DESIGN constraint |
| Server-side draft state under-scoped (thought v2-only) | Med | Med | Flagged as attaching at v1 (slice-01); DESIGN chooses mechanism |
| D2+D4 add-to-list no-op when source==list | Low | Low | Flagged; DESIGN dedups / suppresses prompt |
| Dietary violation leaks via a web recipe's hidden ingredient | Low | High | Hard-gate AC; JOB-003 guardrail alert; SPIKE checks dietary compatibility |
| DIVERGE absent (no design-direction selection) | — | Med | Feature is orchestrator-locked (D1–D8); DESIGN selects persistence + search mechanism |

---

## Wave: DISCUSS / [REF] Definition of Done (stub — populated at DESIGN/DELIVER)

| # | Item | Status |
|---|------|--------|
| 1 | All UAT scenarios pass (green) | Not yet (pre-DESIGN) |
| 2 | Shipped acceptance suite green; `data-*` preserved | Not yet |
| 3 | Deduped plan savings == shipped savings tracker; no double-count | Not yet |
| 4 | Dietary safety: 0 violating recipes surfaced | Not yet |
| 5 | Demoable: generate a real-recipe draft, make it cheapest, save → add to list | Not yet |
| 6 | Merged to main; running locally | Not yet |
