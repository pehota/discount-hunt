<!-- markdownlint-disable MD024 -->
# Feature Delta: discount-hunt-ui

**Wave**: DISCUSS | **Date**: 2026-07-15 | **Agent**: Luna (nw-product-owner)
**Density**: lean + ask-intelligent | **Feature type**: User-facing UI polish (brownfield; presentation-only)

---

## Wave: DISCUSS / [REF] Persona ID

**Persona**: Dimitar Apostolov — software engineer, Munich, single (and only) user, vegetarian, English UI / German grocery vocabulary (Wochenangebote, Angebot, Stammpreis).
Full profile: `docs/product/personas/dimitar.yaml` (v2 usability note added this feature).

Evidence base: solo / owner-driven. Dimitar IS the persona. Interview thresholds skipped by design.

---

## Wave: DISCUSS / [REF] JTBD One-Liners (referencing EXISTING jobs — no new job minted)

This feature mints **no** new job. "Make the UI usable" is a solution-quality constraint on the
already-validated jobs, expressed as new usability ACs + readability KPIs. All stories trace to:

- **JOB-001** — Weekly grocery planning driven by discounts (opp 9). UI delta: discount feed +
  meal plan readable on a phone; the discount behind each meal visible without a click.
- **JOB-002** — Track actual grocery savings vs full price (opp 8). UI delta: the saved figure is
  the glanceable hero of the Savings page.
- **JOB-003** — Ensure meal plan respects dietary restrictions (opp 9). Function ships (SLICE-03 of
  the backend feature); no NEW UI delta this feature — the Settings + filter UI already works.

Source: `docs/product/jobs.yaml` (usability_criteria blocks added under JOB-001 and JOB-002).

---

## Wave: DISCUSS / [REF] Locked Decisions

D1–D10 belong to the backend feature (`docs/feature/discount-hunt/feature-delta.md`). This feature adds:

| ID | Decision | Verdict | Rationale |
|----|----------|---------|-----------|
| D-UI-1 | Job framing | Trace to EXISTING jobs | No new job; UI = solution quality on JOB-001/002/003 (orchestrator-locked) |
| D-UI-2 | Feature type | User-facing UI polish, presentation-only | No new backend behaviour; no new routes |
| D-UI-3 | Walking skeleton | None (brownfield) | Backend + styled shell already ship end-to-end |
| D-UI-4 | UX depth | Comprehensive | Full emotional arc + error paths + shared artifacts (locked) |
| D-UI-5 | Persona | Single = dimitar | Owner-driven; treat as owner requirements |
| **D-UI-6** | **Premise correction** | **Shell is NOT bare-bones** | `src/shared/layout.ts` already ships a design system (CSS vars, cards, sticky nav, banners) and a responsive `.card-grid`; recipe UI + savings UI shipped phases 05–08. Scope corrected to **targeted readability/mobile deltas against the rendered HTML**, NOT a greenfield UI. This narrows scope; it reverses no locked decision. |
| D-UI-7 | Mobile target | 375px, no horizontal scroll | Dimitar's phone is the tightest device for the Monday moment |
| D-UI-8 | data-* attribute preservation | Load-bearing; must survive | `data-week-saved`, `data-saved-amount`, `data-estimated-savings`, `data-month-to-date` are asserted by the shipped acceptance suite (D23). Presentation may change; these must not. |

---

## Wave: DISCUSS / [REF] Baseline Audit (today → target diff — the DoR evidence)

The scope IS this diff. Every story below closes a named, visible gap in the rendered HTML.
Files read: `src/shared/layout.ts`, `discount-handler.ts`, `plan-handler.ts`, `savings-handler.ts`,
`settings-handler.ts`, `recipe-handler.ts`, `html.ts`.

| # | Gap | Today (rendered) | Target | Slice | Confidence |
|---|-----|------------------|--------|-------|-----------|
| G1 | Discount not in plan | `plan-handler.ts renderPlanHtml` rows = `Day \| Slot \| Meal-name` only; store+price only in recipe detail | Store + sale price inline per discounted meal | S02 | CONFIRMED (code read) |
| G2 | Saved figure not the hero | `savings-handler.ts renderThisWeekBreakdown` = 3 equal `<p>` lines, SAVED last | SAVED = dominant first element, above fold at 375px | S03 | CONFIRMED (code read) |
| G3 | No responsive treatment | `layout.ts STYLE` has zero `@media`; `.site-nav` is flex, no `flex-wrap`; two `<table>`s | Nav wraps/collapses + tables stack at 375px | S01 | Horizontal-scroll RISK — inferred from code (nav is the primary suspect); verify by rendering in DELIVER |
| G4 | No explicit per-item saving | `renderStoreSection` shows was/sale, no `save €X` | Explicit `save €X` per card | S04 | CONFIRMED (code read) |

Note on G3: not asserted as "confirmed overflow" — it was not rendered. The `.card-grid` already
collapses to one column; the 3-column tables are narrow *until* S02 widens the plan. The `.site-nav`
(brand + 4 links, no `flex-wrap`) is the real overflow suspect. Stated as risk; DELIVER verifies at 375px.

---

## Wave: DISCUSS / [REF] Scope Assessment (Elephant Carpaccio Gate)

**Verdict: PASS — right-sized. 4 stories, 1 module touched (`src/shared/layout.ts` + 3 handlers), estimated ~3 days total.**

Oversized heuristics — none fire:
- Stories: 4 (< 10). Bounded contexts touched: presentation layer only (< 3). Integration points: 0 new.
- Effort: ~3 days across 4 thin slices, each ≤1 day. No walking skeleton needed (brownfield).

No split proposed. This is a small presentational scope on an existing shell.

---

## Wave: DISCUSS / [REF] Journey Extension (SSOT)

**Journey**: Weekly Discount Meal Planning — EXTENDED IN PLACE, not rewritten.
**Full schema**: `docs/product/journeys/weekly-discount-meal-planning.yaml` (changelog 2026-07-15).

Added a `usability:` (presentation) dimension + one UI-polish Gherkin scenario to steps 1, 2, 4.
Step 3 (recipe detail) already ships store+price inline — no delta.

```
[Mon: read feed]   [Generate plan]   [(recipe detail)]   [Check savings]
      |                  |                  |                   |
   STEP 1             STEP 2            STEP 3             STEP 4
   +save €X badge     +inline store     (unchanged —       +SAVED hero
   +375px readable    +price per meal    already inline)    +375px above-fold
   [G4] [G3]          +375px stack       —                  [G2] [G3]
                      [G1] [G3]
      |                  |                  |                   |
   Curious            Engaged            Confident          Motivated
   ↓                  ↓                  ↓                  ↓
   Hopeful (deal      Pleased (the       (unchanged)        Satisfied (the
   legible at a       plan visibly                          payoff lands at
   glance)            IS the discount)                      a glance)
```

**Emotional arc (unchanged flow, sharpened at the readability level)**: Curious → Hopeful →
Pleased → Confident → Motivated. The polish makes each transition land *on a phone, at a glance* —
it does not add or reorder steps. No jarring transitions introduced.

**Error paths** (all already shipped; this feature must NOT regress them):
1. Scraper stale → `staleness-warning` banner (per-store). Must remain visible + readable at 375px.
2. No compatible discounts → per-store empty-state / restriction-filtered empty-plan warning.
3. Recipe source dead / no match → cached notice / manual Chefkoch search fallback.
4. No regular price → honest "Savings unavailable" (must remain honest after S03 reorders the page).

**Shared artifacts** — see registry below. The load-bearing invariant this feature must protect:
the `data-*` attributes carrying `saved`, `estimated_savings`, `regular/sale price` values.

---

## Wave: DISCUSS / [REF] Target Sketches (proof of understanding — 375px)

Two before/after sketches of the intended target. The journey YAML already holds mockups of the
*current* rendered state; these show the *intended* one for the two most layout-sensitive deltas.

### Savings page — SAVED becomes the hero (US-09 / S03)

```
TODAY (equal-weight list, SAVED last)        TARGET (SAVED is the hero, above the fold @375px)
+------------------------------+             +------------------------------+
| Weekly Savings               |             | Weekly Savings               |
|                              |             |                              |
| Paid: €12.33                 |             |   ┌────────────────────────┐ |
| Would have paid: €20.73      |             |   │      €8.40             │ |  <- large, first
| Saved: €8.40                 |  ------>     |   │   saved this week      │ |
|                              |             |   └────────────────────────┘ |
| Month to date: €8.40         |             | Paid €12.33 · would've €20.73|  <- small, below
| [history table…]             |             | Month to date: €8.40         |
+------------------------------+             | [history table…]             |
                                             +------------------------------+
data-week-saved / data-saved-amount / data-month-to-date preserved VERBATIM (D-UI-8).
```

### Shell + plan — nav wraps, plan stacks (US-07 / US-08, S01 then S02)

```
TODAY @375px (RISK: nav row + plan table          TARGET @375px (nav wraps; plan meals stack;
may exceed viewport width -> horizontal scroll)    S02 store+price sits UNDER the meal name)
+------------------------------+                   +------------------------------+
|DiscountHunt Feed Plan Savings.| <- may clip      | DiscountHunt                 |
|                              |>>| scroll         | Feed  Plan  Savings  Settings|  <- wrapped
| Day | Slot   | Meal          |>>|                | ---------------------------- |
| Mon | Lunch  | Red Lentil… |>>|  (3-col table    | Mon · Lunch                  |
|     |        |               |   widens further  |   Red Lentil Soup            |
+------------------------------+   when S02 adds    |   Aldi Süd €1.19             |  <- S02 inline
                                    store+price)    +------------------------------+
G3 is a RISK inferred from code (no @media; .site-nav has no flex-wrap). Verify by rendering in DELIVER.
```

These are intent sketches, not pixel specs — the exact responsive technique is a DESIGN decision.

---

## Wave: DISCUSS / [REF] Shared Artifacts Registry

| Artifact | Source of truth | Displayed as | Consumers | Integration risk |
|----------|----------------|--------------|-----------|------------------|
| `saved_amount` | `savings_log.saved_amount` (= `meal_plans.estimated_savings`, same-tx D23) | `data-week-saved` / `data-saved-amount` span | Savings page (S03), plan footer | HIGH — S03 reorders/emphasises but the span + value MUST survive verbatim (acceptance suite asserts it) |
| `estimated_savings` | `meal_plans.estimated_savings` | `data-estimated-savings` span | Plan footer (S02 area), savings (D23) | HIGH — S02 enriches the same page; must not disturb this span |
| `regular_price` / `sale_price` | `discount_items` (write-once at scrape, D22) | was/sale on card (S04), store+price in plan (S02) | Feed (S04), plan (S02), recipe detail | MEDIUM — S02/S04 render the same source in a new place; single source, no recompute |
| `store` | `discount_items.store` | per-card heading (feed), inline per meal (S02) | Feed, plan (S02) | LOW — read-only display |
| `dietary_restriction` | `user_settings` (live read) | applied silently | feed filter, plan gen | LOW — not touched by this feature |

Single-source rule holds: S02 and S04 render `regular_price`/`sale_price`/`store` from the same
`discount_items` rows the feed already reads — no second source, no recompute. S03 must NOT
recompute `saved` — it re-presents the existing `data-*` value.

---

## Wave: DISCUSS / [REF] Slice Execution Order

Slice briefs: `docs/feature/discount-hunt-ui/slices/slice-0{1..4}-*.md`.

| # | Slice | Learning hypothesis (disproved if…) | Effort | Priority rationale |
|---|-------|-------------------------------------|--------|--------------------|
| S01 | Mobile-survivable shell (nav + tables) | Nav + tables overflow at 375px — disproved if they already fit cleanly with no regression | ≤1d | 1st — foundation. All content slices must land in a layout that survives 375px. Fixing overflow first prevents S02 from colliding with G3. |
| S02 | Show the discount inside the meal plan | Inline store+price aids the accept/regenerate decision — disproved if Dimitar still clicks into each recipe | ≤1d | 2nd — highest content-value delta (JOB-001 payoff). **Depends on S01** (added content must stack, not widen-overflow). |
| S03 | Make the saved figure the hero | Emphasis changes glance-recognition — disproved if the plain list already communicated it | ≤1d | 3rd — emotional close (JOB-002). No hard dependency. |
| S04 | Per-item "save €X" badge on the feed | Explicit delta aids ranking — disproved if was/sale was already enough | ≤0.5d | 4th — quick win at first contact (JOB-001). No hard dependency. |

**Dependency graph: only S02 → S01.** S02 adds columns to the plan `<table>`, so it must land in S01's mobile-survivable layout (G1+G3 coupling). S03 (reorders `<p>` breakdown, never touches the history table) and S04 (short line inside an already-collapsing `.card`) do NOT widen anything at 375px and carry no hard dependency on S01 — the S01-first ordering is a preference, not a gate. This deliberately avoids gating the two code-confirmed slices (S03, S04) behind S01, whose value rests on the one unverified gap (G3).

---

## Wave: DISCUSS / [REF] User Stories with Elevator Pitches

---

### US-07: Read the Monday planning flow on my phone

**Job**: JOB-001, JOB-002 (usability constraint) · **Slice**: S01 · **MoSCoW**: Must Have

#### Problem
Dimitar does his Monday planning partly on his phone. The app ships a styled desktop layout, but
the site navigation (brand + four links, flexed with no wrap) and the plan/savings tables have no
responsive treatment. On a 375px screen the nav risks clipping and the tables risk horizontal scroll,
making the weekly moment fiddly on the exact device he reaches for first.

#### Who
- Dimitar Apostolov | Monday morning, phone in hand (375px) | Wants to skim the week's plan and savings without pinch-zooming or sideways scrolling.

#### Elevator Pitch
- **Before**: on his phone, Dimitar has to scroll the page sideways to read the plan/savings tables and the nav links crowd off-screen.
- **After**: open any page at `http://localhost/` on a 375px viewport → the nav wraps/collapses cleanly and every table stacks to fit the screen width, no horizontal scroll.
- **Decision enabled**: Dimitar decides his week from his phone in the kitchen instead of waiting until he is at his desktop.

#### Domain Examples
1. **Happy path — phone, full data**: Dimitar opens `/plan` on his iPhone (375px) Monday 07:00. The 7-day plan renders stacked; he scrolls only vertically and reads all 14 meals. Nav shows Feed/Plan/Savings/Settings wrapped onto the available width.
2. **Desktop unchanged**: on his 1440px desktop the same pages render exactly as before this feature — nav in one row, tables full-width. No regression.
3. **Edge — narrow error banner**: the Aldi Süd `staleness-warning` banner is showing. At 375px the banner text wraps and remains fully readable rather than pushing the layout wider than the viewport.

#### UAT Scenarios (BDD)
```gherkin
Scenario: The Monday flow is readable on a 375px phone screen
  Given the app has current-week discount, plan, and savings data
  When Dimitar opens the Feed, Plan, and Savings pages on a 375px-wide viewport
  Then each page fits the viewport width with no horizontal scroll
  And the four navigation links remain reachable without clipping

Scenario: Data tables stack instead of overflowing on a phone
  Given a generated meal plan and at least one week of savings history
  When Dimitar views /plan and /savings at 375px
  Then the meal-plan table and the savings table are readable without sideways scrolling

Scenario: Desktop layout is unchanged
  Given a viewport of 1440px
  When Dimitar views any page
  Then the layout matches the pre-feature desktop rendering (nav on one row, tables full-width)
```

#### Acceptance Criteria
- [ ] At 375px, Feed / Plan / Savings / Settings render with no horizontal scroll.
- [ ] The site nav (brand + 4 links) wraps or collapses without clipping any link at 375px.
- [ ] The plan and savings tables are readable at 375px (stacked/responsive; technique is a DESIGN choice).
- [ ] At ≥960px the layout is unchanged from the pre-feature rendering (visual regression check).
- [ ] Existing warning banners (staleness, empty-state) remain fully readable at 375px.

#### Outcome KPIs
- **Who**: Dimitar
- **Does what**: Completes the Monday planning skim (feed → plan → savings) on his phone
- **By how much**: 0 pages require horizontal scroll at 375px (currently: plan + savings + nav at risk)
- **Measured by**: Manual check at 375px on the running server across all 4 pages; scroll-width == viewport-width
- **Baseline**: No responsive treatment exists beyond the card-grid

#### Technical Notes
- Change is concentrated in `src/shared/layout.ts` `STYLE` (shared shell): a media breakpoint + nav `flex-wrap` + responsive table behaviour.
- Must not alter any page's `data-*` attributes or content.
- `job_id`: JOB-001, JOB-002 (usability constraint on existing jobs)

---

### US-08: See the discount behind each meal without clicking

**Job**: JOB-001 · **Slice**: S02 · **MoSCoW**: Must Have · **Depends on**: US-07 (S01)

#### Problem
The meal plan lists meal names only. Which store the deal is at, and the sale price, only appear
after Dimitar clicks into each meal's recipe detail. At the accept/regenerate moment the plan does
not visibly feel discount-driven — the very connection JOB-001 exists to make is one click away.

#### Who
- Dimitar Apostolov | Reviewing the freshly generated plan before committing to the shop | Wants to see, per meal, that it is built on a real deal — without opening 14 recipe pages.

#### Elevator Pitch
- **Before**: the plan shows "Monday Lunch: Red Lentil Soup" — Dimitar can't tell which discount it rides on without clicking through to the recipe.
- **After**: view `/plan` → each discount-driven meal shows its store + sale price inline, e.g. "Red Lentil Soup — Aldi Süd €1.19", matching the journey mockup.
- **Decision enabled**: Dimitar decides whether to accept or regenerate the plan based on which deals it actually uses, straight from the plan view.

#### Domain Examples
1. **Happy path**: Plan for week of 14 Jul. Monday Lunch "Red Lentil Soup" shows "Aldi Süd €1.19" inline; Monday Dinner "Caprese Salad" shows "Aldi Süd €0.69". Dimitar sees at a glance the plan is built on this week's real Aldi deals and accepts it.
2. **Mixed plan**: 4 discount-driven meals show store + price; the 10 filler meals (`discountItemId === null`) render without a badge and in the differentiated non-discount style, so Dimitar can tell which days are "free-riding" on the deals.
3. **375px**: On his phone the same plan stacks each meal into a card-like row; the store + price sits under the meal name rather than pushing the row wider than the screen.

#### UAT Scenarios (BDD)
```gherkin
Scenario: Each discount-driven meal shows its store and sale price in the plan
  Given a meal plan has been generated and at least one meal uses a discounted item
  When Dimitar views /plan
  Then each meal that uses a discounted item shows that item's store and sale price inline
  And the estimated-savings footer is unchanged (data-estimated-savings preserved)

Scenario: Non-discount meals are visually differentiated
  Given a generated plan containing both discount-driven and filler meals
  When Dimitar views /plan
  Then meals with no discounted item render without a store/price badge
  And they are visually differentiated from discount-driven meals

Scenario: The enriched plan is readable on a phone
  Given a generated plan with per-meal store and price shown
  When Dimitar views /plan at 375px
  Then each meal's store and price is readable with no horizontal scroll
```

#### Acceptance Criteria
- [ ] Each meal whose `discountItemId` is non-null shows the linked item's store and sale price inline in the plan.
- [ ] Meals with `discountItemId === null` show no badge and use the existing non-discount styling.
- [ ] The `data-estimated-savings` span and its value are unchanged by this slice.
- [ ] The recipe-detail link on each in-scope meal name still works.
- [ ] At 375px the enriched plan has no horizontal scroll (lands in the S01 layout).

#### Outcome KPIs
- **Who**: Dimitar
- **Does what**: Judges whether a plan is discount-driven from the plan view alone
- **By how much**: Store + sale price visible for 100% of discount-driven meals with 0 clicks (currently: 0% — requires a click into recipe detail)
- **Measured by**: Rendered `/plan` inspection — count of discount meals with inline store+price / total discount meals
- **Baseline**: 0 clicks-to-see today = impossible (data lives only in recipe detail)

#### Technical Notes
- Data already server-side: `meal.discountItemId` + `discount_items.store`/`.salePrice`. No new query beyond joining data the plan context owns.
- Presentation-only; the plan-generation algorithm and meal selection are untouched.
- Sequencing: land on top of US-07's mobile-survivable table (avoids re-widening the table on mobile — G1+G3 coupling).
- `job_id`: JOB-001

---

### US-09: See how much I saved at a glance

**Job**: JOB-002 · **Slice**: S03 · **MoSCoW**: Must Have · **Depends on**: none (S01-first is a preference, not a gate — S03 does not widen the page)

#### Problem
The Savings page renders Paid / Would-have-paid / Saved as three equal-weight lines, with the SAVED
figure last. The number that is supposed to deliver the emotional payoff of JOB-002 has no more
visual weight than the numbers it should dominate, and on a phone it can fall below the fold.

#### Who
- Dimitar Apostolov | Opening the Savings page after a shopping week, often on his phone | Wants the "how much did I save" number to hit him immediately, without reading a list.

#### Elevator Pitch
- **Before**: on `/savings` Dimitar reads "Paid €12.33 / Would have paid €20.73 / Saved €8.40" as a flat list and has to hunt for the payoff.
- **After**: open `/savings` → "€8.40 saved this week" is the first, largest element on the page, legible above the fold at 375px, with paid / would-have-paid as supporting context beneath.
- **Decision enabled**: Dimitar decides the discount habit is worth continuing because the reward is unmissable each week.

#### Domain Examples
1. **Happy path**: Week of 14 Jul, saved €8.40. Savings page opens with "€8.40 saved" as the hero figure at the top; below it, smaller: paid €12.33, would-have-paid €20.73, then month-to-date and history. Dimitar registers the payoff in under a second.
2. **375px above-fold**: On his phone the €8.40 hero and its "saved this week" label are fully visible without scrolling; the history table sits below the fold, reached by scrolling down.
3. **Honest unavailable**: A week where regular prices were not captured. The hero area shows "Savings unavailable this week" instead of a misleading €0.00 — the honesty of the existing empty-state is preserved even though the layout changed.

#### UAT Scenarios (BDD)
```gherkin
Scenario: The weekly saved figure is the hero of the Savings page
  Given Dimitar has at least one week of savings recorded
  When he opens /savings
  Then the weekly saved amount is the first and most visually prominent figure on the page
  And paid and would-have-paid are shown as supporting context beneath it
  And the data-week-saved value is unchanged from the underlying record

Scenario: The saved figure is legible above the fold on a phone
  Given a week with savings recorded
  When Dimitar opens /savings at 375px
  Then the saved hero figure and its label are visible without scrolling

Scenario: Missing-price weeks stay honest after the redesign
  Given a week where regular prices were not captured
  When Dimitar opens /savings for that week
  Then the hero area shows "Savings unavailable" rather than a €0.00 figure
```

#### Acceptance Criteria
- [ ] The weekly SAVED amount is the first and visually dominant element of `/savings`.
- [ ] Paid and would-have-paid render as secondary context beneath the hero.
- [ ] `data-week-saved`, `data-week-paid`, `data-week-would-have-paid`, `data-saved-amount`, `data-month-to-date` and their values are preserved verbatim (D23 acceptance suite).
- [ ] At 375px the hero figure + label are above the fold.
- [ ] The "Savings unavailable" honest empty-state is preserved when regular prices are missing.
- [ ] History table and month-to-date content are unchanged.

#### Outcome KPIs
- **Who**: Dimitar
- **Does what**: Registers his weekly saving at a glance when opening the Savings page
- **By how much**: SAVED figure is element #1 and above the fold at 375px (currently: line #3, plain weight, can fall below fold)
- **Measured by**: Rendered `/savings` inspection — saved figure is the first content element; visible in the 375px above-fold region
- **Baseline**: Saved is the third equal-weight `<p>` line

#### Technical Notes
- Change in `src/savings/http/savings-handler.ts` `renderThisWeekBreakdown` + a hero style in `layout.ts`.
- MUST re-present, never recompute, the existing `data-*` values.
- `job_id`: JOB-002

---

### US-10: See the exact saving on each discount card

**Job**: JOB-001 · **Slice**: S04 · **MoSCoW**: Should Have · **Depends on**: none (badge fits the already-collapsing card-grid at 375px)

#### Problem
Each discount card shows the was-price and the sale-price but leaves Dimitar to subtract them in his
head. The journey mockup shows an explicit "save €0.80" per item; without it, ranking which deals are
worth building the week around takes extra mental effort at the first-contact moment.

#### Who
- Dimitar Apostolov | Scanning the Monday feed to pick which deals to plan around | Wants the size of each saving obvious so he can rank items fast.

#### Elevator Pitch
- **Before**: a card reads "was €2.29  €1.49" and Dimitar computes the €0.80 saving himself for every item.
- **After**: view `http://localhost/` → each card also shows "save €0.80" (Angebot vs Stammpreis), matching the mockup.
- **Decision enabled**: Dimitar decides which discounted items to prioritise in the week's meals by comparing savings at a glance.

#### Domain Examples
1. **Happy path**: Bio Haferflocken card shows "was €2.29 · €1.49 · save €0.80". Rote Linsen shows "save €0.60". Dimitar quickly picks the biggest-saving items to anchor the week.
2. **Small saving**: Mozzarella "was €0.99 · €0.69 · save €0.30" — the small delta is honestly shown, not hidden or rounded to €0.
3. **375px**: On his phone the card stacks was / sale / save vertically inside the existing single-column card-grid, no overflow.

#### UAT Scenarios (BDD)
```gherkin
Scenario: Each discount card shows the explicit per-item saving
  Given the current week's feed contains discounted items with regular and sale prices
  When Dimitar views /
  Then each card shows an explicit saving amount equal to regularPrice minus salePrice
  And the existing was-price and sale-price are still shown

Scenario: Small savings are shown honestly
  Given an item whose regular price is €0.99 and sale price is €0.69
  When Dimitar views its card
  Then the card shows "save €0.30" (not €0 and not hidden)

Scenario: The saving badge fits on a phone
  Given the feed has discounted items
  When Dimitar views / at 375px
  Then each card including its saving amount fits within the single-column card-grid, no horizontal scroll
```

#### Acceptance Criteria
- [ ] Each discount card shows a saving amount = `regularPrice - salePrice`, computed from the item's own prices.
- [ ] The existing `was-price` and `sale-price` spans are retained.
- [ ] The saving is shown even when small (e.g. €0.30); never suppressed to €0.
- [ ] At 375px the card with the saving fits the card-grid column with no horizontal scroll.

#### Outcome KPIs
- **Who**: Dimitar
- **Does what**: Ranks discount items by saving size on the feed
- **By how much**: Explicit saving shown on 100% of cards (currently 0%; user computes it mentally)
- **Measured by**: Rendered `/` inspection — every card carries the saving amount
- **Baseline**: 0 cards show an explicit saving

#### Technical Notes
- Change in `src/discount/http/discount-handler.ts` `renderStoreSection`. `regularPrice`/`salePrice` already on the item; no new data.
- `job_id`: JOB-001

---

## Wave: DISCUSS / [REF] System Constraints (cross-cutting)

- **Presentation-only**: no story adds/changes backend behaviour, routes, DB schema, or scrape/plan logic.
- **data-* preservation (D-UI-8)**: `data-week-saved`, `data-saved-amount`, `data-estimated-savings`,
  `data-week-paid`, `data-week-would-have-paid`, `data-month-to-date` and their values are asserted by
  the shipped acceptance suite. Any restyle must keep them verbatim.
- **No regression**: existing error states (staleness, empty-state, restriction-filtered, savings-unavailable,
  dead-recipe fallback) and desktop layout must survive every slice.
- **Single-user / local**: no auth, no multi-device sync; "mobile" means Dimitar's own phone against localhost.
- **XSS**: all interpolated scraped text stays routed through `escapeHtml` (`src/shared/html.ts`).

---

## Wave: DISCUSS / [REF] Out of Scope

- New pages, routes, or navigation destinations.
- Any backend / scraper / plan-generation / savings-calculation change.
- Dietary settings UI (JOB-003) — already ships and works; no NEW UI delta.
- Recipe detail view redesign — already shows store+price inline; no delta.
- Kid-friendly / household-size / cooking-time controls — recipe-search params, already in the Settings form (SLICE-05 backend), not a UI-polish target here.
- Dark mode, theming, animation, a11y beyond "readable + no-scroll at 375px" (future).
- Native mobile app / PWA / offline (web responsive is sufficient — per backend Out-of-Scope).

---

## Wave: DISCUSS / [REF] Driving Ports (unchanged — no new surfaces)

`GET /`, `GET /plan`, `POST /plan/generate`, `GET /plan/{day}-{slot}`, `GET /savings`, `GET|POST /settings`.
This feature restyles the HTML these existing ports return. No new port.

---

## Wave: DISCUSS / [REF] Pre-requisites

- None external. Backend + shell already ship (phases 01–08, 204 tests green).
- **Two render-until-DELIVER unknowns** (could not be observed at DISCUSS — no shell/render tool available here):
  1. **G3 — horizontal scroll at 375px** (gates S01/US-07). Inferred from code (`layout.ts` has no `@media`; `.site-nav` has no `flex-wrap`), not rendered. DELIVER must verify at 375px; if it already fits, S01 is a verified no-op (valid outcome).
  2. **US-09 "above the fold" claim**. Whether the SAVED hero sits above the 375px fold depends on rendered heights; DELIVER confirms.
  Everything else (G1, G2, G4) is code-confirmed and needs no render to specify.

---

## Wave: DISCUSS / [REF] Outcome KPIs Summary

### Feature Objective
The Monday weekly-planning flow — feed, plan, savings — is glanceable and phone-readable, so the
already-shipped value of JOB-001/002 lands at a glance on Dimitar's own devices without friction.

### KPI Table (readability / mobile deltas — NOT the already-met function KPIs)

| # | Who | Does What | By How Much | Baseline | Measured By | Type |
|---|-----|-----------|-------------|----------|-------------|------|
| 1 | Dimitar | Completes the Monday skim on his phone | 0 of 4 pages need horizontal scroll at 375px | Plan+savings+nav at risk | Manual 375px check on running server | Leading |
| 2 | Dimitar | Sees the discount behind each meal from the plan | Store+price visible for 100% of discount meals, 0 clicks | 0% (recipe-detail only) | Rendered `/plan` inspection | Leading |
| 3 | Dimitar | Registers weekly savings at a glance | SAVED is element #1, above fold at 375px | Line #3, plain weight | Rendered `/savings` inspection | Leading |
| 4 | Dimitar | Ranks discount items by saving | Explicit saving on 100% of cards | 0% (mental arithmetic) | Rendered `/` inspection | Secondary |

### Metric Hierarchy
- **North Star**: 0 pages requiring horizontal scroll at 375px across the Monday flow.
- **Leading Indicators**: per-meal discount visibility (KPI 2); saved-figure prominence (KPI 3).
- **Guardrail Metrics** (must NOT degrade): desktop layout unchanged; all `data-*` attributes + values preserved; no error-state regressions; shipped acceptance suite stays green (204 tests).

### Measurement Plan
| KPI | Data Source | Collection | Frequency | Owner |
|-----|------------|-----------|-----------|-------|
| 1 | Running server @375px | Manual scroll-width check per page | Per slice + release | Dimitar |
| 2 | Rendered `/plan` HTML | Inspect discount-meal rows | Per S02 | Dimitar |
| 3 | Rendered `/savings` HTML | Inspect element order + 375px fold | Per S03 | Dimitar |
| 4 | Rendered `/` HTML | Inspect cards | Per S04 | Dimitar |

### Hypothesis
We believe that making the Monday flow phone-readable and glanceable for Dimitar will let him do his
weekly planning from his phone with the discount and savings payoff visible at a glance. We will know
this is true when all 4 pages render with no horizontal scroll at 375px, per-meal discounts are visible
in the plan with 0 clicks, and the saved figure is the hero of the Savings page.

---

## Wave: DISCUSS / [REF] Definition of Ready (9-Item Checklist)

| # | Item | Status | Evidence |
|---|------|--------|----------|
| 1 | Problem statement clear, domain language | PASS | Each US Problem is a today→target gap in Dimitar's terms (Angebot/Stammpreis; "phone", "at a glance") |
| 2 | User/persona with specific characteristics | PASS | Dimitar, vegetarian SWE, Munich, phone-at-Monday; `personas/dimitar.yaml` v2 note |
| 3 | 3+ domain examples with real data | PASS | US-07…10 each have 3 examples with real Munich items/prices (Bio Haferflocken €1.49, Rote Linsen, Mozzarella) |
| 4 | UAT in Given/When/Then (3–7 scenarios) | PASS | 3 scenarios per story, all Gherkin |
| 5 | AC derived from UAT | PASS | AC bullets per story, traceable to scenarios |
| 6 | Right-sized (≤1 day/slice, 3–7 scenarios) | PASS | 4 slices ≤1d; 3 scenarios each |
| 7 | Technical notes: constraints/dependencies | PASS | Per-story Technical Notes; System Constraints; data-* preservation |
| 8 | Dependencies resolved or tracked | PASS | Only S02→S01 (plan table widens; must land in the mobile layout). S03/S04 have no hard dependency (they do not widen anything at 375px). No external deps |
| 9 | Outcome KPIs with measurable targets | PASS | 4 readability/mobile KPIs with numeric targets + method + baseline |

### DoR Status: PASSED

---

## Wave: DISCUSS / [REF] Requirements Completeness

**Completeness Score: 0.96**

| Dimension | Coverage | Notes |
|-----------|----------|-------|
| Confirmed gaps with a story | 4/4 (G1–G4) | Each story closes one named rendered-HTML gap |
| Jobs with UI usability ACs | JOB-001, JOB-002 | JOB-003 UI already ships; no delta (correct) |
| Journey steps extended | 3/4 (steps 1,2,4) | Step 3 already ships inline discount; no delta |
| Error/regression paths guarded | 5 | staleness, empty-state, restriction-filtered, savings-unavailable, dead-recipe — all "must not regress" |
| Shared artifacts single-sourced | 5/5 | data-* preservation invariant explicit |
| Mobile NFR quantified | 375px, no horizontal scroll | Concrete threshold, not "user-friendly" |

Deduction (−0.04): G3 (horizontal scroll) is a code-inferred RISK, not a rendered observation.
DELIVER must confirm at 375px. Flagged in Baseline Audit and Pre-requisites; this is correct DISCUSS
behaviour (do not fabricate a rendered result) but leaves one AC target unverified until build.

---

## Wave: DISCUSS / [REF] Risks

| Risk | Prob | Impact | Mitigation |
|------|------|--------|------------|
| G3 overflow assumption wrong (nav/tables already fit) | Low | Low | S01 becomes a no-op verified at 375px; hypothesis disproved is a valid outcome |
| A restyle silently drops a load-bearing `data-*` attr → acceptance suite breaks | Med | High | D-UI-8 constraint + per-story AC pin the attributes; suite (204 tests) is the gate |
| S02 widens the plan table and reintroduces mobile overflow | Med | Med | Explicit S02→S01 dependency (the ONLY hard slice dependency); S02 content must stack in the S01 layout |
| Certain-value slices gated behind the one unverified gap | Low | Med | Dependency mapping corrected: S03/S04 carry NO hard dependency on S01; they can ship even if G3 proves a no-op |
| Premise drift (someone treats this as greenfield UI) | Low | Med | D-UI-6 records the correction; Baseline Audit is the SSOT for "what already exists" |

---

## Wave: DISCUSS / [REF] Wave Decisions Summary

- Premise corrected (D-UI-6): shell already styled + responsive card-grid; scope = targeted readability/mobile deltas, not greenfield UI. Not a reversal of any locked decision.
- No new job; all 4 stories trace to JOB-001/JOB-002 as solution-quality usability ACs (jobs.yaml updated additively).
- Journey extended in place (steps 1,2,4 gain a usability dimension + 1 UI scenario each); flow unchanged.
- 4 thin slices. S01-first is a preference; the ONLY hard dependency is S02→S01 (plan table widens — G1+G3 coupling). S03/S04 do not widen anything at 375px and carry no hard dependency, so the two code-confirmed slices are not gated behind G3 (the one unverified gap).
- KPIs are readability/mobile deltas, deliberately NOT the already-met function KPIs.
- DIVERGE absent (brownfield polish) — no design-direction selection needed; acceptable for this scope.
