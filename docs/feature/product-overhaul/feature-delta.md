<!-- markdownlint-disable MD024 -->
# Feature Delta: product-overhaul

**Wave**: DISCUSS | **Date**: 2026-07-15 | **Agent**: Luna (nw-product-owner)
**Density**: lean + ask-intelligent | **Feature type**: User-facing (strategic reframe; backend follows)

> Strategic, vision-level umbrella feature. It (1) reframes the product's job hierarchy so
> **controlling grocery expenditure** is PRIMARY and meal planning is SUPPORTING, and (2) introduces
> a **shopping list as the central artifact**. Carpaccio-split into 4 thin slices. Docs-only; no code.

---

## Wave: DISCUSS / [REF] Persona ID

**Persona**: Dimitar Apostolov — software engineer, Munich, vegetarian, English UI / German grocery
vocabulary (Wochenangebote, Angebot, Stammpreis, Preisvergleich). Full profile:
`docs/product/personas/dimitar.yaml` (v3 note this feature: added forward-cost goals + `household`
block — the budget being controlled is shared with his wife; still single-operator, no auth).

Evidence base: solo / owner-driven (Dimitar + his wife's own usage ideas). Interview thresholds
skipped by design.

---

## Wave: DISCUSS / [REF] JTBD One-Liners

Full jobs + reframe rationale: `docs/product/jobs.yaml` (see `hierarchy:` block + changelog).

- **JOB-004 (NEW, PRIMARY)** — When assembling the household grocery shop, Dimitar wants to build one
  deliberate list favouring this week's cheapest items but including the staples they need, and see
  the running total as he builds it, so he knows what the shop costs **before the till** instead of
  discovering it there.
- **JOB-002 (SUPPORTING, re-parented under JOB-004)** — the retrospective half of spend control:
  know how much was saved vs full price after the shop.
- **JOB-001 (SUPPORTING)** — discount-driven meal planning as inspiration / decision-support feeding
  items into the shop.
- **JOB-003 (SUPPORTING)** — dietary compatibility as a safety constraint on feed, list, and plan.

---

## Wave: DISCUSS / [REF] Changed Assumptions (the strategic reframe)

This feature changes the product's job hierarchy. Recording it explicitly per the reframe protocol.

### Prior framing (quoted verbatim from `docs/product/jobs.yaml`, JOB-001, pre-reframe)

> **JOB-001 "Weekly grocery planning driven by discounts"** — *"When I am planning my weekly grocery
> shopping and have no idea what discounts are available this week, I want to see what is cheapest
> RIGHT NOW across Aldi Süd, Edeka, and V-Markt in Munich and get a meal plan built around those
> discounts, so I can cook real meals all week and spend significantly less than if I shopped without
> looking at promotions first."*

And the original DISCUSS delta stated: *"Primary job: When planning weekly groceries … Dimitar wants
to generate a discount-first 7-day meal plan …"* — i.e. **meal planning was the primary job**.

### New framing

The vision states the **MAIN GOAL is managing grocery expenditure**, with meal planning explicitly
**SUPPORTING**. Therefore:

| Job | Was | Now | What changed |
|-----|-----|-----|--------------|
| JOB-004 (new) | — | **PRIMARY** | Minted: forward-looking spend control via an assembled, costed shopping list |
| JOB-002 | supporting (savings) | **SUPPORTING**, re-parented under JOB-004 | Recognised as the retrospective half of spend control; NOT folded/deleted |
| JOB-001 | **PRIMARY** | **SUPPORTING** | Repositioned as inspiration/decision-support; statement + score UNCHANGED |
| JOB-003 | supporting | **SUPPORTING** | Unchanged in scope; reach extends to feed + list, not only the plan |

### Rationale (bias-guarded)

- JOB-004's high opportunity (importance 5 / satisfaction 1) comes from **low satisfaction on the
  FORWARD half of spend control** — the shipped app measures savings only *retrospectively* (JOB-002)
  and has no notion of "the shop I am about to make" or its cost before the till. It is **NOT** derived
  by rescoring JOB-001 downward (that would be confirmation-bias retrofitting). JOB-001 keeps its own
  high opportunity as a supporting job.
- **No job deleted, folded, or renumbered.** All IDs preserved verbatim — shipped and in-flight
  stories carry `job_id: JOB-001/002/003` (a hard traceability gate); breaking those IDs would orphan
  them.
- The reframe is recorded additively in `jobs.yaml` (annotations + `hierarchy:` block + changelog).
  DISCOVER-era statements are untouched.

---

## Wave: DISCUSS / [REF] Locked Decisions

D1–D10 belong to `discount-hunt` and D11–D37 to its DESIGN wave; D-UI-* to `discount-hunt-ui`.
This feature adds D-PO-* decisions:

| ID | Decision | Verdict | Rationale |
|----|----------|---------|-----------|
| D-PO-1 | Job reframe | Expenditure control (JOB-004) = PRIMARY; meal planning (JOB-001) = SUPPORTING | Orchestrator-locked from the vision's stated main goal. Recorded additively; IDs preserved. |
| **D-PO-2** | **Information architecture** | **Shopping list is the CENTRAL artifact**; meal plan + recipe inspiration are supporting flows OFF it | The vision's main goal is the costed shop, not the meal plan. The list holds "what I'm actually buying + its cost". Drives all downstream slicing. |
| D-PO-3 | Shopping-list origin | List = PERSISTED evolution of the in-flight cross-store **selection overview panel** | The overview is the selection's transient view; the list is its durable, running-total form. Avoids specifying a duplicate artifact. |
| D-PO-4 | Fate of the existing selection→meal-plan flow | **PRESERVED** as a supporting branch | Selection now fans out to (list \| plan \| recipe ideas) instead of being consumed solely by plan generation. Generate still replaces the week's plan; savings dedup guard intact. |
| D-PO-5 | Feed scope | Feed = **ALL discounts** (nothing pre-hidden except dietary-incompatible), **NOT** the full catalogue | Cheap reading of "Feed shows ALL products". Full-catalogue scraping is a backend expansion, flagged as OQ-PO-1/expensive reading, not built. |
| D-PO-6 | Non-discounted add | **Free-text manual entry** with optional user-typed price | Cheap reading of "add an item even if not discounted". No full-catalogue lookup (that is the expensive reading, OQ-PO-1). Honest-total handling for price-unknown rows. |
| D-PO-7 | Filters are ADDITIVE | store AND category AND name combine, never replace | Explicit in the vision. Category is a NEW third filter dimension. |
| D-PO-8 | Discount sort | Price ascending (cheapest first) by default | Explicit in the vision. |
| D-PO-9 | Recipe inspiration | NEW entry point that **EXTENDS** shipped `RecipeService`/`ChefkochRecipeSource` | Selection/all-discounts seed instead of a single planned meal. Reuse, don't rebuild (SLICE-05 shipped). |
| D-PO-10 | Price immutability on list | Captured `sale_price` is write-once on a list row (like `regular_price`, D22) | A list item keeps its captured price even if the discount expires mid-week; the total must not silently drift. |
| D-PO-11 | Single source for savings | List-level savings reuses the JOB-002 `regular_price - sale_price` computation from the same `discount_items` rows | Two disagreeing savings numbers would break trust in the reframe. |

---

## Wave: DISCUSS / [REF] Scope Assessment (Elephant Carpaccio Gate — run EARLY, before journey investment)

**Verdict: OVERSIZED as an umbrella → SPLIT into 4 thin slices (each ≤1 day).**

Oversized signals (this is a vision-level umbrella, so it fires as expected):

| Signal | Present? | Detail |
|--------|----------|--------|
| >10 user stories if left whole | YES (as umbrella) | Feed filters, sort, list core, persistence, manual add, recipe-from-selection, IA rework |
| Multiple independent user outcomes that could ship separately | YES | "find deals fast", "know the shop's cost", "include staples", "get inspired" are separable |
| Touches backend + frontend + a NEW persisted artifact | YES | New `shopping_list` persistence + feed changes + recipe entry point |
| >3 bounded contexts | NO | Reuses discount/pricing, meal-planning, recipe, savings contexts; adds a list concern |
| Walking skeleton required | NO | Brownfield; substantial app already ships end-to-end |

**Action**: split into 4 slices, prioritised by learning-leverage + value (below). Each slice has a
brief at `docs/feature/product-overhaul/slices/slice-0{1..4}-*.md` with goal / IN-OUT / hypothesis /
ACs / deps / estimate.

### Carpaccio taste tests (per slice)

| Test | S01 (filter+sort) | S02 (list core) | S03 (manual add) | S04 (recipe ideas) |
|------|-------------------|-----------------|------------------|--------------------|
| ≤1 day? | Yes | Yes (discounted-only) | Yes | Yes |
| End-to-end user-visible behaviour? | Yes (narrow + sort feed) | Yes (build + cost a list) | Yes (add a staple) | Yes (get ideas) |
| Independently demoable? | Yes | Yes | Yes (on S02) | Yes |
| Delivers value alone? | Yes (faster deal-finding) | Yes (KEYSTONE — forward cost) | Yes (whole-shop cost) | Yes (inspiration) |
| At least one user-visible story (not all @infrastructure)? | Yes | Yes | Yes | Yes |

All 4 pass. No slice is all-infrastructure.

---

## Wave: DISCUSS / [REF] Journey Map (NEW primary journey)

**Journey**: Grocery Expenditure Control — **new file**
`docs/product/journeys/grocery-expenditure-control.yaml`.
The existing `weekly-discount-meal-planning.yaml` is UNCHANGED and remains valid as the now-SUPPORTING
meal-planning flow.

```
[Scan feed]        [Add to list]      [Review list]        [Meal plan]*     [Recipe ideas]*
 all discounts      discounted +        running total        (existing        (NEW entry pt,
 additive filters   manual staples      = shop cost          Generate flow    extends Chefkoch)
 cheapest-first                          before the till     preserved)
      |                 |                    |                    |                 |
   STEP 1            STEP 2               STEP 3               STEP 4            STEP 5
      |                 |                    |                    |                 |
   Anxious           Deliberate           Evaluative           Curious          Curious
   ↓                 ↓                    ↓                    ↓                ↓
   Oriented          In control           CONFIDENT            Inspired         Inspired
                                          (knows the cost)
   * = SUPPORTING flows off the list (JOB-001) — not the hub.
```

**Emotional arc**: expenditure ANXIETY / uncertainty → CONTROL building (total climbs visibly as the
list assembles) → CONFIDENCE / relief ("I know this shop costs €X, before the till, within budget").
No jarring transitions: each add is a small win that builds control incrementally.

**Central artifact (D-PO-2/-3)**: the **shopping list** — persisted evolution of the in-flight
selection overview. Meal plan and recipe inspiration fan OUT from the list/selection.

**Critical error paths** (journey step failure_modes):
1. Filter combo yields zero → "No items match" + clear-filters (never a blank feed).
2. Manual item with no price → added, marked "price unknown", excluded from numeric total,
   "+N items without a price" note (total stays honest).
3. Empty list → "add items from the feed" (never a blank total).
4. List persistence fails → surface error, keep in-memory list, never silently lose it.
5. Recipe no-match / dead source → shipped manual-search / cached fallbacks.
6. Discount expires mid-week after an item is on the list → captured `sale_price` persists (D-PO-10).

---

## Wave: DISCUSS / [REF] Story Map (Backbone + Slices)

### Backbone (user activities, left → right — the primary spine)

| Find deals | Build the shop | Know the cost | Get inspired |
|------------|----------------|---------------|--------------|
| Filter feed (store) *(in-flight)* | Select item *(in-flight overview)* | See running total (S02) | Recipe idea from selection (S04) |
| Filter feed (category) **(S01 NEW)** | Add discounted item → list (S02) | See list-level savings (S02) | Recipe idea from all discounts (S04) |
| Search by name *(in-flight)* | Add non-discounted staple (S03) | List persists (S02) | Add ingredients back to list (S04) |
| Sort cheapest-first **(S01 NEW)** | Remove / adjust qty (S02) | Honest total w/ price-unknown (S03) | (meal plan = supporting, existing) |

### Walking skeleton

**None** — brownfield. The app already ships an end-to-end discount→plan→savings flow. The reframe
rides on that; the new keystone (S02) is not a skeleton but the highest-leverage increment.

### Priority Rationale (learning-leverage + value; not effort-first)

| # | Slice | One-line goal | NEW vs built/in-flight | Value×Urgency/Effort | Rationale |
|---|-------|---------------|------------------------|----------------------|-----------|
| 1 | **S02** shopping-list core | Select → persisted list + running total = the shop's cost before the till | NEW (persists in-flight selection overview) | 5×5/3 ≈ 8.3 | KEYSTONE. Validates the WHOLE reframe (does a costed list deliver JOB-004?). Highest learning leverage despite not being the easiest. Everything else refines it. |
| 2 | **S01** category filter + price sort | Narrow the feed by a 3rd additive filter; sort cheapest-first | NEW (extends in-flight store-filter/search) | 4×3/2 = 6 | Low-risk additive quick win; makes the feed that feeds S02 usable. Independent value (faster deal-finding). |
| 3 | **S03** non-discounted add | Add staples so the list = the WHOLE shop | NEW | 4×3/2 = 6 | Completes the "whole shop cost" promise. Depends on S02 (needs the list). Cheap reading only (D-PO-6). |
| 4 | **S04** recipe inspiration from selection | "What can I cook with these?" seeded by selection / all discounts | NEW entry point extending SHIPPED Chefkoch | 3×2/2 = 3 | Supporting-job inspiration. Most useful once the list exists to receive suggestions. Reuse, don't rebuild. |

Tie-break note: S02 outranks the easier S01 because riskiest-assumption-first — S02 validates the
reframe's core assumption; S01 only optimises an already-working feed.

### Already-built / in-flight (NOT re-planned — baseline for this feature)

- Mobile redesign, store filter pills, per-card selection checkboxes → meal-plan generator, per-meal
  Chefkoch recipe integration: **shipped**.
- Product-name search, selected-card highlight, cross-store selection overview panel: **in-flight**
  (another agent, concurrent). This feature's S02 **persists** that overview; S01 adds a filter
  alongside the search; S03's entry point rides the search. Do not duplicate them.

---

## Wave: DISCUSS / [REF] User Stories with Elevator Pitches

---

### US-PO-01: Build a persisted shopping list and see what the shop will cost

**Job**: JOB-004 · **Slice**: S02 · **MoSCoW**: Must Have

#### Problem
Dimitar assembles the household shop each week for himself and his wife. Today he can browse discounts
and generate a meal plan, but the app never holds "the set of things I am actually buying" or tells him
what that basket will cost. He finds out the real total **at the till**, which turns the weekly shop
into a budget surprise instead of a decision.

#### Who
- Dimitar Apostolov | planning the household shop, often on his phone | Wants to know the shop's cost before leaving, building on this week's cheapest items.

#### Elevator Pitch
- **Before**: Dimitar picks items and generates a plan, but has no single place holding "what I'm buying" or its cost — he discovers the total at the till.
- **After**: tap "+ Add" on discounted feed items at `http://localhost/` → a persistent "Shopping List (N) — €X.XX" badge shows a live running total, and `/list` shows every item grouped by store with the total "€4.26 · saving €1.40".
- **Decision enabled**: Dimitar decides what to buy and whether the shop is within the household budget *before* leaving for the store.

#### Domain Examples
1. **Happy path — costed basket**: Dimitar adds Rote Linsen (Aldi €1.19), Mozzarella (Aldi €0.69), Campari Tomaten (Edeka €1.29). The badge reads "Shopping List (3) — €3.17". On `/list` he sees the three items grouped by store, total €3.17, and "saving €1.10 on the discounted items". He knows the cost before the till.
2. **Edit down to budget**: The total reaches €18.40 against a €15 mental cap. Dimitar removes the €2.49 Gouda; the total drops to €15.91 instantly. He removes one more and lands under budget.
3. **Persistence across sessions**: Dimitar builds a 6-item list Monday morning on his phone, closes the app, and reopens it Monday evening on his laptop — the same 6 items and total are still there.

#### UAT Scenarios (BDD)
```gherkin
Scenario: Adding a discounted item builds the list and shows the running total
  Given this week's feed shows "Rote Linsen 500g" on sale at Aldi Süd for €1.19
  When Dimitar taps "+ Add" on that item
  Then the item appears on his shopping list with store "Aldi Süd" and price €1.19
  And the shopping-list running total increases by €1.19

Scenario: Removing an item updates the running total immediately
  Given a shopping list totalling €4.26
  When Dimitar removes the €1.29 Campari Tomaten item
  Then the total updates to €2.97 without a full reload

Scenario: The shopping list persists across sessions within the week
  Given Dimitar built a shopping list and closed the app
  When he reopens the app later the same week
  Then his shopping list items and running total are still present

Scenario: List-level savings match the shipped savings computation
  Given a list of discounted items with known regular and sale prices
  When Dimitar views the list total
  Then the shown saving equals the sum of (regular price − sale price) over those items
  And this matches the value the existing savings tracker would report for the same items

Scenario: The existing selection-to-meal-plan flow still works
  Given Dimitar has a shopping list built from selected discounted items
  When he taps "Generate meal plan"
  Then a discount-driven meal plan is generated as before
  And the weekly savings are not double-counted (existing dedup guard holds)

Scenario: List persistence fails without silent data loss
  Given Dimitar has built a shopping list of three items
  And the list persistence layer is unavailable
  When the app attempts to persist the list
  Then an error is surfaced (e.g. "Could not save your list — retrying")
  And the built list and its running total remain visible in the current session
  And no item is silently dropped
```

#### Acceptance Criteria
- [ ] "+ Add" on a discounted item creates a list row referencing the discount item (price = its sale price, captured write-once).
- [ ] A running total (`SUM(sale_price × qty)`) shows on the list and as a feed badge "Shopping List (N) — €X.XX".
- [ ] Removing an item or changing quantity re-derives the total immediately.
- [ ] Duplicate add of the same item increments quantity rather than adding a second row.
- [ ] The list and its items persist across sessions within the week.
- [ ] List-level savings use the same `regular_price − sale_price` computation and rows as the shipped savings tracker (no divergent number).
- [ ] The existing selection→Generate-meal-plan flow is preserved (savings dedup guard intact).
- [ ] If list persistence fails, an error is surfaced and the built list stays visible in-session; no item is silently lost.

#### Outcome KPIs
- **Who**: Dimitar
- **Does what**: Knows the shop's cost from an assembled list before leaving for the store
- **By how much**: Shop total known before the till for 100% of weekly shops (currently 0% — total discovered at the till)
- **Measured by**: Presence of a persisted `shopping_list` with a non-empty total prior to the shopping day; self-reported "knew the cost beforehand"
- **Baseline**: 0% — no forward cost figure exists today

#### Technical Notes
- New persisted `shopping_list` / `shopping_list_items` (survives session within week). Solution-neutral at DISCUSS; schema decided in DESIGN.
- Reuses `discount_items` as the price source; captured `sale_price` is write-once (D-PO-10).
- List savings reuse the JOB-002 computation (D-PO-11) — single source, no recompute.
- Builds on the in-flight cross-store selection overview panel (persist its state).
- `job_id`: JOB-004

---

### US-PO-02: Narrow the feed by category and sort cheapest-first

**Job**: JOB-004, JOB-001 · **Slice**: S01 · **MoSCoW**: Must Have

#### Problem
This week's feed can hold dozens of discounted items across three stores. Dimitar can filter by store
and search by name (in-flight), but he cannot narrow by *category* (e.g. just dairy, just produce),
and the items are not ordered by price — so finding the cheapest relevant deals to put on the list
takes more scrolling and scanning than it should.

#### Who
- Dimitar Apostolov | scanning the Monday feed to pick deals for the list | Wants to zero in on the cheapest relevant items fast.

#### Elevator Pitch
- **Before**: Dimitar filters by store and name but must eyeball the whole list to find, say, the cheapest dairy deals.
- **After**: on `http://localhost/` set Store "Aldi Süd" + Category "Dairy" + search "Mozz" (all combine) → sees only matching Aldi dairy items, ordered cheapest-first.
- **Decision enabled**: Dimitar decides which deals to add to the list faster by comparing the cheapest matching items directly.

#### Domain Examples
1. **Additive combination**: Store "Aldi Süd" + Category "Grains" narrows to Bio Haferflocken (€1.49) and Rote Linsen (€1.19), ordered €1.19 then €1.49. Typing "Linsen" narrows further to just Rote Linsen — the store and category filters stay active.
2. **Cheapest-first default**: With no filters, the feed lists Mozzarella €0.69, Rote Linsen €1.19, Bio Haferflocken €1.49, Campari Tomaten €1.29 … in ascending sale price.
3. **Uncategorised bucket**: An item whose category cannot be derived appears under "Uncategorised" rather than vanishing from the feed.

#### UAT Scenarios (BDD)
```gherkin
Scenario: Store, category, and name filters combine additively
  Given this week's feed has discounted items across several stores and categories
  When Dimitar selects store "Aldi Süd" and category "Dairy" and types "Mozz"
  Then only Aldi Süd dairy items matching "Mozz" are shown
  And clearing the name filter widens the results while keeping store and category active

Scenario: Discounted items are sorted cheapest-first by default
  Given the feed contains discounted items at various sale prices
  When Dimitar opens the feed
  Then the items are displayed in ascending order of sale price

Scenario: A filter combination with no matches is explained
  Given no item matches store "V-Markt" and category "Bakery"
  When Dimitar applies that combination
  Then the feed shows "No items match these filters"
  And a one-tap clear-filters action is offered
```

#### Acceptance Criteria
- [ ] A category filter is available and combines additively with the existing store filter and name search (all three AND together; clearing one keeps the others).
- [ ] Discounted items are ordered by sale price ascending by default.
- [ ] Items with no derivable category appear under "Uncategorised" (never dropped).
- [ ] A zero-match combination shows an explanatory message with a clear-filters affordance.

#### Outcome KPIs
- **Who**: Dimitar
- **Does what**: Finds the cheapest relevant deals for the list using combined filters + price sort
- **By how much**: Reaches a target category's cheapest item in ≤2 interactions (currently: scroll + visual scan of the whole feed)
- **Measured by**: Rendered feed inspection — category filter present, additive, price-sorted
- **Baseline**: No category dimension; no explicit price order

#### Technical Notes
- Requires a `category` on `discount_items`. If absent, a normalizer-level derivation is the slice's first task (see OQ-PO-2). If category cannot be reliably derived, degrade to price-sort-only + documented gap.
- Additive-filter contract shared with the in-flight store filter + name search.
- `job_id`: JOB-004, JOB-001

---

### US-PO-03: Add a needed item to the list even when it is not on sale

**Job**: JOB-004 · **Slice**: S03 · **MoSCoW**: Must Have · **Depends on**: US-PO-01 (S02)

#### Problem
A real weekly shop is more than the deals — Dimitar and his wife always need staples (milk, eggs)
whether or not they are discounted. If the list can only hold discounted items, its running total is
not the *real* shop cost, so it cannot be trusted for a budget decision.

#### Who
- Dimitar Apostolov | building the shop and realising a staple isn't on sale | Wants to add it anyway so the list = the whole shop.

#### Elevator Pitch
- **Before**: Dimitar can only add discounted items; the staples they always buy can't go on the list, so the total isn't the real shop cost.
- **After**: search "Vollmilch 1L", get no discount, choose "add it anyway", optionally type €1.09 → it joins the list and the running total includes it.
- **Decision enabled**: Dimitar decides the shop against the *true* total — deals plus staples — not just the deal subtotal.

#### Domain Examples
1. **Staple with price**: "Vollmilch 1L" has no discount. Dimitar adds it with price €1.09; the list total rises by €1.09 and the row shows "manual".
2. **Staple without price**: He adds "Eier 10er" but doesn't know the price, leaves it blank. The row shows "price unknown", the numeric total is unchanged, and a note reads "+1 item without a price".
3. **Mixed real shop**: A list of 3 discounted items (€3.17) plus 2 priced staples (€2.18) shows total €5.35 — the actual shop cost, grouped Aldi / Edeka / Manual.

#### UAT Scenarios (BDD)
```gherkin
Scenario: Dimitar adds a needed staple that is not on sale
  Given Dimitar searches for "Vollmilch 1L" and no discounted match is found
  When he chooses to add it anyway and enters the price €1.09
  Then "Vollmilch 1L" appears on the list as a manual item priced €1.09
  And the running total includes the €1.09

Scenario: A manual item with no price is counted honestly
  Given Dimitar adds a manual item "Eier 10er" and leaves the price blank
  When the item is added
  Then it appears marked "price unknown"
  And the numeric running total does not change
  And the list shows "+1 item without a price"

Scenario: Manual and discounted items coexist grouped on the list
  Given a list with discounted items and priced manual staples
  When Dimitar views the list
  Then discounted items are grouped by store and manual items under "Manual"
  And the total is the sum of all priced items
```

#### Acceptance Criteria
- [ ] Dimitar can add a free-text manual item with an optional price and quantity to the list.
- [ ] A manual item with a price contributes that price to the running total.
- [ ] A manual item without a price is added, marked "price unknown", excluded from the numeric total, and surfaced as "+N items without a price".
- [ ] Manual items are visually distinguished from discounted items (e.g. a "Manual" group).
- [ ] The "add anyway" prompt appears when a name search yields no discount (degrades to a direct "add item" affordance if the in-flight search is not present).

#### Outcome KPIs
- **Who**: Dimitar
- **Does what**: Represents the whole shop (deals + staples) in one costed list
- **By how much**: Non-discounted staples present on the list for shops that need them (currently impossible: 0%)
- **Measured by**: Rendered `/list` inspection — presence of manual rows; honest-total behaviour for price-unknown rows
- **Baseline**: 0% — no way to add a non-scraped item

#### Technical Notes
- CHEAP reading (D-PO-6): free-text + optional user price. NO full-catalogue lookup (that is OQ-PO-1's expensive reading, not built here).
- Manual price is nullable; price-unknown rows must not silently understate the total.
- `job_id`: JOB-004

---

### US-PO-04: Get recipe ideas from a selection or from all this week's discounts

**Job**: JOB-001, JOB-004 · **Slice**: S04 · **MoSCoW**: Should Have · **Depends on**: shipped Chefkoch recipe integration; soft-depends on US-PO-01 (S02) for "add to list"

#### Problem
Dimitar sees cheap chicken (or a fridge of cheap discounted odds and ends) and doesn't know what to
cook with it. The shipped recipe lookup works per *planned meal* — there is no way to say "here are
the items I'm eyeing, inspire me" or "what can I cook from everything on sale this week?".

#### Who
- Dimitar Apostolov | looking at cheap raw items, short on meal ideas | Wants recipe inspiration seeded by what's cheap or by what he selected.

#### Elevator Pitch
- **Before**: recipes appear only for meals already in a generated plan; Dimitar can't ask "what can I cook with THESE cheap items?".
- **After**: select "Rote Linsen" + "Campari Tomaten" (or select nothing) → tap "Get recipe ideas" → sees Chefkoch-sourced ideas seeded by the selection (or by all discounts), each with an "add ingredients to list" action.
- **Decision enabled**: Dimitar decides what to cook — and what to add to the shop — based on ideas grounded in this week's cheapest items.

#### Domain Examples
1. **From a selection**: Dimitar selects Rote Linsen + Campari Tomaten and asks for ideas. He gets "Red Lentil & Tomato Soup" and "Linsen-Tomaten-Dal" from Chefkoch, each linkable and each offering to add its ingredients to the list.
2. **From all discounts**: With no selection, he asks "what can I cook from this week's discounts?" and gets a mixed set of vegetarian ideas seeded by the full discounted set — none containing meat or fish (JOB-003).
3. **No match → fallback**: An oddball selection returns no recipe. He sees "No recipe ideas found — try a different selection" and the shipped manual Chefkoch search link.

#### UAT Scenarios (BDD)
```gherkin
Scenario: Recipe ideas from a selection of discounted items
  Given Dimitar has selected "Rote Linsen" and "Campari Tomaten" from the feed
  When he asks for recipe ideas from that selection
  Then recipe ideas using those ingredients are shown with links to their source
  And each idea offers to add its ingredients to the shopping list

Scenario: Recipe ideas from all of this week's discounts
  Given Dimitar has made no specific selection
  When he asks "what can I cook from this week's discounts?"
  Then recipe ideas seeded by the full discounted set are shown
  And no recipe idea violates Dimitar's vegetarian restriction

Scenario: No matching recipe falls back gracefully
  Given a selection for which the recipe source returns no match
  When Dimitar asks for recipe ideas
  Then a "No recipe ideas found — try a different selection" message is shown
  And the shipped manual Chefkoch search link is offered
```

#### Acceptance Criteria
- [ ] A "get recipe ideas" entry point accepts either a user selection or (when none) all of this week's discounts as the seed.
- [ ] Ideas are produced by the existing `RecipeService` / `ChefkochRecipeSource` (cache-first, reused — not rebuilt).
- [ ] The dietary restriction (JOB-003) constrains the idea query, consistent with the meal-plan filter.
- [ ] Each idea links to its source and offers "add ingredients to list" (into the S02 list).
- [ ] No-match uses the shipped manual-search fallback; a dead source uses the shipped cached notice.

#### Outcome KPIs
- **Who**: Dimitar
- **Does what**: Gets recipe inspiration grounded in this week's cheapest items / his selection
- **By how much**: Recipe ideas reachable from a selection or all-discounts in 1 action (currently 0 — only per planned meal)
- **Measured by**: Presence of selection→recipe-idea entry point events; ideas rendered from a seed
- **Baseline**: 0 — recipe lookup is per-planned-meal only

#### Technical Notes
- EXTENDS shipped SLICE-05 (`GET /plan/{day}-{slot}` per-meal lookup). Reuses cache + fallbacks; NEW is the seed (selection/all-discounts) and entry point.
- Kid-friendly / household-size recipe-search params are a SEPARATE, already-identified concern (memory `preferences-model-split`) — not this slice.
- LLM-generated recipes remain out of scope (future good-to-have).
- `job_id`: JOB-001, JOB-004

---

## Wave: DISCUSS / [REF] System Constraints (cross-cutting)

- **Reuse over rebuild**: the shopping list persists the in-flight selection overview; recipe
  inspiration extends the shipped Chefkoch integration; list savings reuse the JOB-002 computation.
  No parallel/duplicate artifacts.
- **Single source for prices + savings**: list rows read `sale_price`/`regular_price` from
  `discount_items` (write-once, D22/D-PO-10). No recompute; no divergent savings number (D-PO-11).
- **Honest totals**: price-unknown manual rows never silently understate the running total.
- **Additive filters (D-PO-7)**: store AND category AND name combine; never replace.
- **Dietary safety (JOB-003)**: constrains feed candidates and recipe queries, not only the plan.
- **No regression**: the shipped discount→plan→savings flow, the selection→meal-plan flow (D-PO-4),
  mobile layout, `data-*` attributes (D-UI-8), and the green acceptance suite must all survive.
- **Single-user / local**: no auth; "household" describes whose budget, not extra accounts.
- **XSS**: interpolated scraped + user-typed text routes through `escapeHtml` (`src/shared/html.ts`).
  Manual item names are user input — must be escaped.
- **Concurrency note**: another agent is concurrently editing `discount-handler.ts` and `layout.ts`;
  DESIGN/DELIVER must rebase on their landed store-filter/search/overview work before building S01–S04.

---

## Wave: DISCUSS / [REF] Shared Artifacts Registry

| Artifact | Source of truth | Displayed as | Consumers | Integration risk |
|----------|-----------------|--------------|-----------|------------------|
| `shopping_list_item` | `shopping_list_items` (NEW) — discounted (ref `discount_items`) or manual | list row: name, price, store/'manual' | list view (S02/S03), plan seed (S04), recipe seed (S04) | HIGH — new central artifact; persistence + write-once price are load-bearing |
| `list_total` | computed `SUM(unit_price×qty)` over priced rows | "TOTAL €X.XX (+N no price)" / feed badge | feed badge (S01/S02), list footer (S02/S03) | HIGH — THE forward-cost number JOB-004 exists for; price-unknown handling must keep it honest |
| `list_savings` | computed `SUM(regular−sale)` over discounted rows (REUSES JOB-002) | "saving €X.XX on discounted items" | list footer, shipped savings tracker | HIGH — must equal the shipped tracker's number for the same rows (D-PO-11) |
| `sale_price` / `regular_price` | `discount_items` (write-once, D22/D-PO-10) | feed price, list price, saving | feed (S01), list (S02), savings | MEDIUM — same source rendered in a new place; captured value frozen on the list row |
| `category` | `discount_items.category` (NEW; derived at normalize — OQ-PO-2) | category filter | feed filter (S01) | MEDIUM — field may not exist yet; derivation is a slice prerequisite |
| `selection` | in-flight cross-store selection (transient) → persisted into `shopping_list_items` | "From: …" / selected cards | list (S02), recipe seed (S04), plan seed | MEDIUM — bridges in-flight (another agent) and this feature; coordinate the seam |
| `recipe_idea` | `RecipeService`/`ChefkochRecipeSource` (shipped, cache-first 7d TTL) | idea title + link + add-ingredients | recipe ideas (S04), add-back to list (S03/S04) | LOW — reused as-is; only the seed/entry point is new |
| `dietary_restriction` | `user_settings` (live read, shipped) | applied silently | feed filter, recipe query | LOW — reused; reach extended to feed + recipe seed |

Single-source rule holds: prices and savings derive from the same `discount_items` rows the feed and
the shipped savings tracker already read; recipe machinery is reused; the list is the one new artifact.

---

## Wave: DISCUSS / [REF] Driving Ports (Inbound Surfaces)

Existing (unchanged): `GET /`, `GET /plan`, `POST /plan/generate`, `GET /plan/{day}-{slot}`,
`GET /savings`, `GET|POST /settings`.

New/likely (solution-neutral — exact routes are a DESIGN decision):
- `GET /list` — shopping list view + running total (S02)
- add/remove/qty actions on the list (S02/S03) — e.g. `POST /list/add`, `POST /list/remove`
- manual add (S03) — e.g. `POST /list/add-manual`
- recipe-ideas entry point (S04) — e.g. `GET|POST /ideas?from=selection|all`
- feed category filter + sort are query params on `GET /` (S01)

---

## Wave: DISCUSS / [REF] Pre-requisites

- **In-flight work must land first**: product-name search, selected-card highlight, and the
  cross-store selection overview panel (another agent, concurrent, editing `discount-handler.ts` +
  `layout.ts`). S02 persists the overview; S01 adds a filter beside the search; S03 rides the search.
  DESIGN/DELIVER rebases on their landed work.
- **OQ-PO-2 (category source)** gates S01's filter dimension — resolve during S01 or degrade to
  price-sort-only.
- No external prerequisites for S02/S03/S04 beyond the shipped stack (Bun/SQLite/Drizzle/HTMX,
  RecipeService/ChefkochRecipeSource live).

---

## Wave: DISCUSS / [REF] Open Questions (need the user's decision)

| # | Question | Default taken (cheap reading) | Expensive alternative | Risk |
|---|----------|-------------------------------|-----------------------|------|
| **OQ-PO-1** (raise first) | "Add a non-discounted item" and "Feed shows ALL products" — free-text/all-discounts, or full product catalogue? | **Free-text manual add** (D-PO-6) + **feed = all discounts** (D-PO-5) | Scrape + maintain the FULL store catalogue (not just the ~20% with both prices) so any product is lookupable and the feed can show non-discounted products. This is a substantial BACKEND expansion (new scrape scope, storage, price freshness). | HIGH if the expensive reading is intended — it is a separate backend-prerequisite slice, not costed here. Built to cheap reading; **RESOLVED 2026-07-15 — user confirmed the cheap reading** (feed = all discounts; non-discounted add = free-text + optional price). Full-catalogue expensive reading explicitly deferred. |
| OQ-PO-2 | Does `discount_items` carry a usable `category`? | Derive category at normalize time; else "Uncategorised" | Curated category taxonomy | MED — gates S01's category filter; degrade path exists (price-sort-only) |
| OQ-PO-3 | Is the shopping list weekly (resets with the flyer cycle) or persistent across weeks? | Assume **weekly** (aligns with discount validity + write-once prices) | Rolling multi-week list | LOW — weekly matches the existing week-scoped model; confirm in DESIGN |
| OQ-PO-4 | Should list-level savings feed the shipped savings tracker, or only display on the list? | Display on list; reuse computation but don't double-write savings_log until the shop is confirmed | Auto-record on list build | MED — double-counting risk (savings_log is INSERT-only; regenerate guard exists). Keep display-only until DESIGN resolves recording semantics. |

---

## Wave: DISCUSS / [REF] Outcome KPIs Summary

### Feature Objective
Within 4 weeks of the reframed product, Dimitar assembles the household shop as a single costed list
and **knows what it will cost before leaving for the store**, with the cheapest deals surfaced and
recipe ideas on hand — turning grocery spend from a till-surprise into a deliberate, in-budget decision.

### KPI Table

| # | Who | Does What | By How Much | Baseline | Measured By | Type |
|---|-----|-----------|-------------|----------|-------------|------|
| 1 | Dimitar (household) | Spends on discounted rather than full-price items across the weekly shop | **≥40% of weekly shop spend (€) is on discounted items** | unknown / untracked (deals not part of a costed shop today) | `shopping_list` — SUM(discounted rows €) ÷ SUM(all priced rows €) | Leading (North Star, expenditure) |
| 2 | Dimitar (household) | Keeps the weekly shop within the household budget target | **≥3 of 4 weekly shops come in at or under the budget target**; supports the persona's 20–30% monthly spend-reduction goal | no forward total exists → cannot compare to budget | `shopping_list` total vs a budget target; monthly € trend | Lagging (impact, expenditure) |
| 3 | Dimitar | Knows the shop's cost before the till, from an assembled list | Forward total known for 100% of weekly shops | 0% (total found at till) | Persisted non-empty `shopping_list` total pre-shop; self-report | Leading |
| 4 | Dimitar | Builds the WHOLE shop in the list (deals + staples) | ≥1 manual staple present on shops that need them | 0% (impossible today) | `/list` inspection — manual rows present | Leading |
| 5 | Dimitar | Finds the cheapest relevant deal fast | Target category's cheapest item in ≤2 interactions | scroll + scan whole feed | Feed interaction inspection | Secondary |
| 6 | Dimitar | Gets recipe inspiration from what's cheap / selected | Ideas from selection or all-discounts in 1 action | 0 (per-meal only) | Ideas entry-point usage | Secondary |

> KPIs 1–2 are the expenditure-denominated outcomes (€ / % of spend) tied directly to JOB-004 and the
> persona's "reduce monthly grocery spend 20–30%" constraint. KPIs 3–6 are the leading/secondary process
> metrics that predict them (a costed list you know before the till is the mechanism by which spend on
> discounts rises and shops stay in budget).

### Metric Hierarchy
- **North Star**: % of weekly shop spend (€) on discounted items (KPI 1) — the expenditure outcome JOB-004 exists for.
- **Impact (lagging)**: weekly shops within the household budget target / monthly € spend reduction (KPI 2).
- **Leading Indicators**: forward shop-cost known before the till (KPI 3); whole-shop completeness (KPI 4); deal-finding speed (KPI 5).
- **Guardrail Metrics (must NOT degrade)**: shipped acceptance suite green; `data-*` attributes + values
  preserved (D-UI-8); list savings == shipped savings tracker for the same rows (no divergence);
  savings_log not double-counted (OQ-PO-4); desktop + 375px layouts unregressed.

### Hypothesis
We believe that making a persisted, running-total shopping list the central artifact for Dimitar
will let him know the household shop's cost before the till and decide the shop deliberately, raising
the share of spend on discounts and keeping shops within budget. We will know this is true when
≥40% of weekly shop spend is on discounted items, ≥3 of 4 shops come in at/under the budget target,
and a non-empty forward total exists before the shopping day.

### Handoff to DEVOPS (instrumentation)
- **Data to capture**: per shopping-list, SUM(€) of discounted rows and SUM(€) of all priced rows;
  the list forward total; a household budget-target value; monthly € spend trend.
- **Guardrail alerts**: list savings must equal the shipped savings tracker for the same rows (alert on divergence).
- **Baseline**: KPI 1 (% spend on discounts) and KPI 2 (in-budget rate) have no baseline today — collect
  from the first weeks post-release.

---

## Wave: DISCUSS / [REF] Definition of Done (Completion Checklist)

Populated at DESIGN/DELIVER wave completion — not DISCUSS scope. Stubbed here to complete the DoR/DoD pair
(mirrors the `discount-hunt` feature-delta convention).

| # | Item | Status |
|---|------|--------|
| 1 | All UAT scenarios pass in the acceptance suite (green) | Not yet (pre-DESIGN) |
| 2 | Shipped acceptance suite still green; `data-*` attributes preserved (D-UI-8) | Not yet |
| 3 | List savings == shipped savings tracker for the same rows (no divergence) | Not yet |
| 4 | Desktop + 375px layouts unregressed; existing error states intact | Not yet |
| 5 | Feature demoable to Dimitar end-to-end (build a costed list, know the cost before the till) | Not yet |
| 6 | Merged to main; running locally | Not yet |

---

## Wave: DISCUSS / [REF] Definition of Ready (9-Item Checklist)

| # | Item | Status | Evidence |
|---|------|--------|----------|
| 1 | Problem statement clear, domain language | PASS | Each US Problem in Dimitar's terms (till-surprise, Angebot/Stammpreis, staples, household budget) |
| 2 | User/persona with specific characteristics | PASS | Dimitar, vegetarian SWE, Munich, household budget w/ wife; `personas/dimitar.yaml` v3 |
| 3 | 3+ domain examples with real data | PASS | US-PO-01…04 each have 3 examples with real Munich items/prices (Rote Linsen €1.19, Mozzarella €0.69, Vollmilch €1.09) |
| 4 | UAT in Given/When/Then (3–7 scenarios) | PASS | 3–6 scenarios per story (US-PO-01 has 6 incl. persistence-failure), all Gherkin |
| 5 | AC derived from UAT | PASS | AC bullets per story, traceable to scenarios |
| 6 | Right-sized (≤1 day/slice, 3–7 scenarios) | PASS | 4 slices ≤1d; 3–5 scenarios each; oversized umbrella split |
| 7 | Technical notes: constraints/dependencies | PASS | Per-story Technical Notes + System Constraints + open questions |
| 8 | Dependencies resolved or tracked | PASS | In-flight deps (search/overview) tracked; S03→S02, S04→shipped-Chefkoch; OQ-PO-1/2 flagged |
| 9 | Outcome KPIs with measurable targets | PASS | 6 KPIs — 2 expenditure-denominated (% spend on discounts ≥40%; in-budget rate), 4 process — each with numeric target + method + baseline |

### DoR Status: PASSED (OQ-PO-1 RESOLVED 2026-07-15 — user confirmed the cheap reading: discounts feed + free-text manual add; DESIGN unblocked)

---

## Wave: DISCUSS / [REF] Requirements Completeness

**Completeness Score: 0.93**

| Dimension | Coverage | Notes |
|-----------|----------|-------|
| Reframe recorded (jobs + hierarchy + Changed-Assumptions) | Yes | jobs.yaml annotated + hierarchy block; JOB-001 quoted verbatim |
| Vision items covered by a story | 6/7 | filter(S01), price-sort(S01), select→list(S02), non-discount-add(S03), recipe-inspiration(S04), main-goal-expenditure(S02/JOB-004). "Feed shows ALL products" covered as all-discounts (D-PO-5); full-catalogue reading flagged (OQ-PO-1) not built |
| Jobs with a story | JOB-004, JOB-001, JOB-002(reuse), JOB-003(constraint) | JOB-004 primary has US-PO-01; supporting jobs referenced |
| Error/edge paths | 6 | zero-match filter, price-unknown honest total, empty list, persistence failure, recipe no-match/dead source, mid-week discount expiry |
| Shared artifacts single-sourced | 8/8 | registry; list-savings == shipped tracker invariant explicit |
| IA decision resolved | Yes | D-PO-2/-3/-4: list central; selection→plan preserved |

Deductions (−0.07): OQ-PO-1 (feed/non-discount scope) and OQ-PO-2 (category source) are unresolved
scope forks with buildable cheap-reading defaults; OQ-PO-4 (savings recording semantics) deferred to
DESIGN. Correct DISCUSS behaviour (flag forks, build the plain reading), but the expensive readings
are not costed until the user confirms.

---

## Wave: DISCUSS / [REF] Risks

| Risk | Prob | Impact | Mitigation |
|------|------|--------|------------|
| OQ-PO-1: user actually wants full-catalogue feed/lookup | Med | High | Cheap reading built + flagged as #1 open question; expensive reading is a separate costed backend slice, not smuggled in |
| Concurrent-edit collision with in-flight search/overview work (`discount-handler.ts`, `layout.ts`) | Med | Med | This feature is docs-only; DESIGN/DELIVER rebases on landed in-flight work; S02 persists (not rebuilds) the overview |
| List savings diverges from shipped savings tracker | Low | High | D-PO-11 single-source invariant + AC pin; registry marks HIGH risk |
| savings_log double-count when list savings recorded | Med | High | OQ-PO-4: keep list savings display-only until DESIGN resolves recording; existing regenerate guard referenced |
| Reframe misread as deleting/renumbering jobs | Low | High | Additive annotations; IDs preserved verbatim; Changed-Assumptions quotes prior framing |
| Category field absent | Med | Low | OQ-PO-2 degrade path: price-sort-only + documented gap |

---

## Wave: DISCUSS / [REF] Out of Scope

- Full product-catalogue scraping / non-discounted product lookup (OQ-PO-1 expensive reading) — a
  separate backend-prerequisite slice if the user confirms the expansive reading.
- Multi-user / auth / multi-device sync (single operator; household = shared budget only).
- Recording list-level savings into `savings_log` on list build (OQ-PO-4; display-only for now).
- Kid-friendly / household-size recipe-search params (separate, already-identified; memory `preferences-model-split`).
- LLM-generated recipes (future good-to-have).
- Budget cap / spend-limit enforcement on the list total (a warn banner exists on plans; list-total
  budget gating is a candidate future increment, not this feature).
- New cities / stores; native mobile / PWA / offline (per prior Out-of-Scope).

---

## Wave: DISCUSS / [REF] Wave Decisions Summary

- **Reframe (D-PO-1)**: JOB-004 minted as PRIMARY (control grocery spend); JOB-001 → SUPPORTING;
  JOB-002 re-parented under JOB-004; JOB-003 unchanged. Additive in jobs.yaml, IDs preserved,
  Changed-Assumptions quotes JOB-001 verbatim.
- **IA (D-PO-2/-3/-4)**: shopping list is the CENTRAL artifact = persisted evolution of the in-flight
  selection overview; meal plan + recipe inspiration are supporting flows off it; the existing
  selection→meal-plan flow is preserved.
- **Scope forks (D-PO-5/-6, OQ-PO-1)**: built to the cheap reading (feed = all discounts; non-discount
  add = free-text). Expensive full-catalogue reading flagged as the #1 open question, not built.
- **Slicing**: oversized umbrella split into 4 thin ≤1-day slices, prioritised by learning-leverage:
  S02 (list core, KEYSTONE) → S01 (filter+sort) → S03 (manual add) → S04 (recipe ideas). Only hard
  dep: S03→S02. S04 soft-depends on S02 + shipped Chefkoch. S01 soft-depends on in-flight search.
- **Reuse (D-PO-9/-10/-11)**: extend shipped Chefkoch; write-once list prices; single-source savings.
- **SSOT updates**: new journey `grocery-expenditure-control.yaml`; `jobs.yaml` reframed additively;
  persona v3 (`household` block + forward-cost goals). Existing meal-planning journey untouched.
- **DIVERGE absent**: no design-direction selection ran; the reframe is orchestrator-locked from the
  vision. Risk noted; DESIGN wave will select persistence + route design for the list.
