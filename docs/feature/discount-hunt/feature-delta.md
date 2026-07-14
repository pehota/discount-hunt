# Feature Delta: discount-hunt

**Wave**: DISCUSS | **Date**: 2026-07-13 | **Agent**: Luna (nw-product-owner)
**Density**: lean + ask-intelligent | **Feature type**: Cross-cutting (greenfield)

---

## Wave: DISCUSS / [REF] Persona ID

**Persona**: Dimitar Apostolov — software engineer, Munich, single user, vegetarian.
Full profile: `docs/product/personas/dimitar.yaml`

---

## Wave: DISCUSS / [REF] JTBD One-Liner

**Primary job**: When planning weekly groceries with no knowledge of current promotions, Dimitar wants to generate a discount-first 7-day meal plan filtered to his dietary restrictions, so he can cook real meals while spending meaningfully less than unplanned shopping.

Three jobs identified (all in `docs/product/jobs.yaml`):
- JOB-001: Weekly grocery planning driven by discounts (opportunity score: 9)
- JOB-002: Track actual grocery savings vs full price (opportunity score: 8)
- JOB-003: Ensure meal plan respects dietary restrictions (opportunity score: 9)

---

## Wave: DISCUSS / [REF] Locked Decisions

| ID | Decision | Verdict | Rationale |
|----|----------|---------|-----------|
| D1 | JTBD analysis | YES | All user stories must trace to jobs.yaml |
| D2 | Feature type | Cross-cutting | Backend: scraper + recipe engine + cache. Frontend: meal plan UI + savings tracker |
| D3 | Walking skeleton | YES (greenfield) | One store + one discount + one meal + one savings record, end-to-end |
| D4 | UX research depth | Lightweight | Single-user; Dimitar IS the persona; journey brief is sufficient |
| D5 | Slicing discipline | Elephant Carpaccio ≤1 day | Overrides default 1-3 day sizing; each slice needs a learning hypothesis |
| D6 | Scraping approach | Plain HTTP — no headless browser | Aldi Süd prospekt endpoint (prospekt.aldi-sued.de) serves static JSON with zero bot protection. Slug discovered via single HEAD → 302 Location header. Playwright/Puppeteer not required. SPIKE-01 validated. |
| D7 | Recipe source | Brave Search API → top result → schema.org/Recipe extraction | Query Brave Search API (free tier: 2,000/mo; personal-use volume ~200/mo) with discounted ingredient names; fetch top result; parse schema.org/Recipe JSON-LD. Brave preferred: own index, privacy-friendly, no Google/Microsoft dependency. Bing as fallback if German ingredient query quality is poor. DuckDuckGo excluded (no public search API). LLM-generated recipes parked as future good-to-have (on-demand regeneration). |
| D8 | Regular price baseline | MUST capture at scrape time | Savings tracker requires both prices; deleting regular_price after promotion ends breaks savings history |
| D9 | Single user | YES | No auth, no multi-tenancy; dietary restrictions stored as single-user settings |
| D10 | Locale/city extensibility | Architecture must support | English UI default; more cities/locales as future release |

---

## Wave: DISCUSS / [REF] Scope Assessment

**Verdict**: PASS with structural split

Scope signals detected:
- Bounded contexts: 4 (scraper, discount/pricing, recipe matching, savings tracking)
- Integration points: scraper → discount DB, discount DB → meal planner, meal planner → recipe engine, recipe engine → UI, discount DB → savings tracker
- Estimated effort: 2-3 weeks total

Action taken: Split into 5 Elephant Carpaccio slices (≤1 day each) rather than 1 oversized feature.
Walking skeleton: SLICE-01 (one store, one discount, one meal, one savings amount — fully end-to-end).

---

## Wave: DISCUSS / [REF] Journey Map

**Journey**: Weekly Discount Meal Planning
**Full schema**: `docs/product/journeys/weekly-discount-meal-planning.yaml`

```
[Mon morning]     [Generate plan]    [View recipe]    [Check savings]
      |                 |                 |                 |
STEP 1            STEP 2            STEP 3            STEP 4
Discount Feed →   Meal Plan w/      Recipe detail     Savings
  by store          savings est.      + source link     tracker
  regular price                                         history
  + sale price
      |                 |                 |                 |
  Curious           Engaged           Practical         Satisfied
  ↓                 ↓                 ↓                 ↓
  Hopeful           Pleased           Confident         Motivated
```

**Emotional arc**: Curious/sceptical → Hopeful (discounts visible) → Pleased (plan built) → Confident (recipe feasible) → Motivated (savings confirmed)

**Key shared artifacts**:
- `regular_price` — captured at scrape time; must persist beyond promotion period
- `dietary_filter` — user setting; applied at meal plan generation AND recipe view
- `estimated_savings` — computed from discount_items; shown in step 2 footer AND step 4 tracker
- `refresh_timestamp` — signals data freshness; drives staleness warning

**Critical error paths**:
1. Scraper fails → show stale data + staleness warning (not a blank screen)
2. No diet-compatible discounts → explain + offer manual refresh
3. Recipe source dead → show cached content, flag as unavailable
4. No regular price captured → savings comparison unavailable; display specific message

---

## Wave: DISCUSS / [REF] WS Strategy

**Strategy A (Vertical slice — single capability)**

Walking skeleton = SLICE-01: Aldi Süd scraper → one discounted item in DB → one-meal plan → one savings record shown in UI.

Covers all 4 bounded contexts end-to-end with minimal scope. Each subsequent slice adds breadth (more stores, more meals, more history depth).

---

## Wave: DISCUSS / [REF] Story Map (Backbone + Slices)

### Backbone (user activities, left to right)

| Fetch Discounts | Filter & Plan | Match Recipes | Track Savings | Configure Settings |
|----------------|---------------|---------------|---------------|-------------------|
| Scrape Aldi Süd | Filter by dietary restriction | Find recipe for discounted ingredients | Store regular + sale prices | Set dietary restrictions |
| Scrape Edeka | Generate 7-day meal plan | Display recipe with source link | Compute weekly savings | Add/remove stores |
| Scrape V-Markt | Show discounts in UI | Handle missing recipe | Monthly savings history | Locale settings |
| Schedule weekly | Refresh on demand | Cache recipes | Savings by store | |
| Handle scrape failure | Staleness warning | | | |

### Walking Skeleton

One task per activity, minimum end-to-end:
1. Fetch Discounts → scrape Aldi Süd, store 1 item with regular + sale price
2. Filter & Plan → generate a 1-meal plan from that item (no dietary filter yet)
3. Match Recipes → stub: hardcoded placeholder recipe URL (e.g., "https://example.com/red-lentil-soup") linked to the meal; real recipe engine in SLICE-05
4. Track Savings → show concrete savings (e.g., "Saved €0.80 on Bio Haferflocken") for that item
5. Configure Settings → (deferred to SLICE-03 — settings required for dietary filter)

---

### Slice Execution Order

| # | Slice | Learning Hypothesis | Effort | Priority Rationale |
|---|-------|---------------------|--------|--------------------|
| S01 | Walking Skeleton — Aldi only, 1 meal, 1 saving | Does the end-to-end pipeline produce a usable result at all? | ≤1 day | First: highest uncertainty; de-risks the scraping assumption before any breadth investment. All subsequent slices are blocked on this. |
| S02 | Full 7-day plan + all 3 stores | Does discount-first planning work when ingredient variety is real? | ≤1 day | Second: extends proven pipeline; tests variety hypothesis with full data. Unlock 7-day plan for Dimitar to actually use. |
| S03 | Dietary restriction filter | Does filtering meaningfully reduce the plan's usability edge cases? | ≤1 day | Third: required for the app to be usable by Dimitar daily. S02 breadth needed to provide enough items for the filter to be meaningful. |
| S04 | Savings history (multi-week) | Does historical tracking reinforce usage behaviour? | ≤1 day | Fourth: S01 already writes week-1 to savings_log; this slice adds display depth. Independent of S03 and S05. |
| S05 | Recipe source integration | Does linking to real recipes complete the planning loop? | ≤1 day | Fifth: requires SPIKE-02 to complete first (recipe source selection); depends on S02 named meals. Highest external dependency. |

---

## Wave: DISCUSS / [REF] User Stories with Elevator Pitches

<!-- markdownlint-disable MD024 -->

---

### US-01: View this week's discount feed

**Job**: JOB-001
**Slice**: SLICE-01 (Walking Skeleton)
**MoSCoW**: Must Have

#### Problem
Dimitar is a software engineer who shops at Aldi Süd, Edeka, and V-Markt in Munich. He finds it wasteful to browse 3 separate supermarket websites every Monday for 30-45 minutes. He wants the week's discount items surfaced automatically in one view.

#### Who
- Dimitar Apostolov | Monday morning, planning the week's grocery shop | Wants to know what is cheapest this week without manual browsing

#### Elevator Pitch
Before: Dimitar manually browses 3 supermarket websites every Monday to find this week's offers, spending 30-45 minutes with no guarantee of completeness.
After: open the app's discount dashboard at `http://localhost/` → sees a grouped list of discounted items by store (e.g., "Aldi Süd — Bio Haferflocken 500g €1.49 was €2.29") with a "Last refreshed" timestamp.
Decision enabled: Dimitar decides which discounted items are worth building this week's meals around before generating the meal plan.

#### Domain Examples

**1. Happy path — all 3 stores have data**
Dimitar opens the app on Monday 14 Jul 2026. The scraper ran at 06:00. Dashboard shows 12 items across Aldi Süd (Bio Haferflocken, Mozzarella, Rote Linsen), Edeka (Campari Tomaten, Gouda jung), V-Markt (Basmati Reis, Bio Paprika). Timestamp reads "Last refreshed: Mon 06:00." He spots Rote Linsen on sale and decides to base Monday dinner on lentils.

**2. Stale data — scraper failed**
The Aldi Süd scraper failed on Sunday night due to a website layout change. The app shows last week's Aldi Süd data with a yellow banner: "Aldi Süd data may be outdated — last refresh was 7 days ago." Edeka and V-Markt data is fresh. Dimitar can still see 8 current items from those 2 stores and proceeds.

**3. No compatible items — dietary filter eliminates all**
V-Markt this week only has meat-focused deals. After dietary filtering, V-Markt shows 0 compatible items. The app shows "No compatible discounts at V-Markt this week" in that store's section rather than an empty unexplained section.

#### UAT Scenarios (BDD)

```gherkin
Scenario: Dimitar sees this week's discount feed on a successful scrape day
  Given the weekly scraper ran successfully within the past 24 hours
  And at least one discounted item was found across Aldi Süd, Edeka, or V-Markt
  When Dimitar opens the discount dashboard
  Then discounted items are displayed grouped by store
  And each item shows the sale price and the original regular price
  And a "Last refreshed" timestamp shows the time of the most recent successful scrape

Scenario: Dashboard shows staleness warning when scraper data is more than 2 days old
  Given the most recent successful scraper run was 3 days ago
  When Dimitar opens the discount dashboard
  Then the last-known discounts are still displayed
  And a prominent warning reads "Data may be outdated — last refreshed {N} days ago"
  And the "Generate Meal Plan" button remains accessible

Scenario: Store section shows no compatible items when dietary filter eliminates all
  Given Dimitar's dietary restriction is "vegetarian"
  And the current week's V-Markt data contains only meat and fish products
  When Dimitar opens the discount dashboard
  Then the V-Markt section displays a message "No compatible discounts this week"
  Rather than an empty unexplained section
```

#### Acceptance Criteria
- [ ] Discount feed is grouped by store (Aldi Süd / Edeka / V-Markt)
- [ ] Each item shows: item name, sale price, regular price, savings amount (€)
- [ ] "Last refreshed" timestamp is visible and reflects actual scraper run time
- [ ] If last refresh > 2 days ago, a staleness warning banner appears
- [ ] If all items for a store are filtered by dietary restrictions, the store section shows a "No compatible discounts" message (not blank)
- [ ] "Generate Meal Plan" button is always visible regardless of data state

#### Outcome KPIs
- **Who**: Dimitar
- **Does what**: Opens app and sees this week's discount feed without manually browsing supermarket websites
- **By how much**: Reduces grocery-browsing time from 30-45 min to <2 min per week
- **Measured by**: Self-reported time estimate after 4 weeks of use
- **Baseline**: 30-45 minutes weekly (manual browsing)

#### Technical Notes
- Regular price MUST be stored at scrape time; do not derive from current pricing
- Staleness threshold: 2 days (configurable in DESIGN wave)
- Scraper feasibility validated in post-DISCUSS SPIKE before architecture is committed
- `job_id`: JOB-001

---

### US-02: Generate a discount-driven 7-day meal plan

**Job**: JOB-001, JOB-003
**Slice**: SLICE-01 (Walking Skeleton, 1-meal version) → SLICE-02 (7-day, 3-store)
**MoSCoW**: Must Have

#### Problem
Dimitar has seen this week's discounts but translating "Rote Linsen is on sale" into "what do I cook this week?" requires manual effort he does not want to do. He needs the app to make the discount→meal connection automatically.

#### Who
- Dimitar Apostolov | After viewing the discount feed, ready to commit to a weekly grocery plan | Wants a ready-to-use meal plan with minimal review

#### Elevator Pitch
Before: Dimitar sees that Rote Linsen and Mozzarella are on sale but must manually think through "what meals use these?" and whether the combination covers a full week.
After: click "Generate Meal Plan" on the discount dashboard → sees a 7-day schedule (e.g., "Monday Lunch: Red Lentil Soup — Rote Linsen ON SALE €1.19") with each discounted ingredient highlighted and a total "Estimated savings this week: €8.40" footer.
Decision enabled: Dimitar decides whether to accept this week's plan or regenerate to try different meal combinations.

#### Domain Examples

**1. Happy path — 7 days fully covered with discounts**
Dimitar clicks "Generate Meal Plan." The system finds 7 discounted vegetarian items across 3 stores sufficient to build 14 meals (lunch + dinner × 7 days). Plan shows: Monday Lunch Red Lentil Soup (Rote Linsen sale), Monday Dinner Caprese Salad (Mozzarella sale), etc. Footer reads "Estimated savings this week: €8.40." All items are vegetarian.

**2. Edge case — fewer than 7 unique discounted items**
Only 4 compatible discounted items available this week. Planner fills days 1–4 with discount-driven meals, then fills days 5–7 with budget-friendly non-sale meals (clearly marked "No discount this day" in a lighter style). Estimated savings still shown for the 4 discount days only.

**3. Error — no compatible meals at all**
All discounted items this week are pork products. After vegetarian filter, 0 items remain. App shows: "Cannot generate a discount-driven plan with your current dietary restrictions this week. Consider updating your restrictions or trying a manual plan."

#### UAT Scenarios (BDD)

```gherkin
Scenario: Dimitar generates a full 7-day plan from this week's discounts
  Given the discount feed contains at least 5 items compatible with Dimitar's dietary restrictions
  When Dimitar clicks "Generate Meal Plan"
  Then a 7-day meal plan is displayed with lunch and dinner for each day
  And at least 70% of meals highlight a discounted ingredient from this week
  And an estimated weekly savings total in euros is displayed below the plan

Scenario: Plan generation respects the vegetarian dietary restriction
  Given Dimitar's dietary restriction setting is "vegetarian"
  And the current discount feed includes both meat products and vegetarian products
  When Dimitar generates a meal plan
  Then every meal in the 7-day plan is vegetarian
  And no meal ingredients include meat or fish

Scenario: Plan partially fills when discount variety is low
  Given the discount feed contains only 3 vegetarian items
  When Dimitar generates a meal plan
  Then days covered by discounted items are shown with highlighted sale ingredients
  And remaining days are filled with budget-friendly non-discount meals
  And the non-discount days are visually differentiated from discount-driven days

Scenario: No compatible meals available
  Given Dimitar's dietary restriction is "vegetarian"
  And all discounted items this week contain meat
  When Dimitar clicks "Generate Meal Plan"
  Then an explanatory message appears: "No discount-compatible meals available this week with your current dietary restrictions"
  And a link to dietary restriction settings is shown
```

#### Acceptance Criteria
- [ ] Meal plan covers 7 days (lunch and dinner)
- [ ] Discounted ingredients are visually highlighted in the plan
- [ ] Estimated weekly savings (€) shown below plan, derived from sale_price vs regular_price
- [ ] All meals comply with user's dietary restriction setting
- [ ] When insufficient discounts exist, non-discount meals fill remaining days with clear visual differentiation
- [ ] When zero compatible meals exist, an error message with a link to settings is shown

#### Outcome KPIs
- **Who**: Dimitar
- **Does what**: Generates a discount-first meal plan without any manual ingredient-to-recipe mapping
- **By how much**: Meal planning time drops from 20+ minutes manual to <30 seconds
- **Measured by**: Self-reported time; observable via "plan generated" events in app logs
- **Baseline**: 20-30 minutes weekly (manual)

#### Technical Notes
- Meal plan generation algorithm is solution-neutral at DISCUSS; architecture decided in DESIGN wave
- Recipe source (API or static DB) deferred to SPIKE
- dietary_filter applied BEFORE meal selection — not after
- `job_id`: JOB-001, JOB-003

---

### US-03: View recipe detail for a planned meal

**Job**: JOB-001
**Slice**: SLICE-05
**MoSCoW**: Must Have

#### Problem
Dimitar's meal plan includes "Red Lentil Soup" for Monday lunch but he does not know how to make it. He needs a recipe with real preparation steps, not just a name, to actually cook the meal. If the recipe requires 3 hours or obscure ingredients, he needs to know now — not at 7pm Monday.

#### Who
- Dimitar Apostolov | Reviewing the meal plan before finalising grocery shopping | Needs to verify each meal is feasible to cook given his skill level and available pantry items

#### Elevator Pitch
Before: the meal plan shows meal names but Dimitar must separately search for recipes, losing the connection between "this is a discount-driven meal" and "here is how to cook it."
After: click any meal title in the plan → opens a recipe detail panel showing the ingredient list (with sale items highlighted), preparation steps, and an "Open original recipe" link to the recipe source.
Decision enabled: Dimitar decides whether to keep this meal in the plan or swap it for something he can realistically cook.

#### Domain Examples

**1. Happy path — recipe found with source link**
Dimitar clicks "Red Lentil Soup" on Monday. A panel opens showing: ingredients (Rote Linsen 500g — ON SALE Aldi Süd €1.19, Campari Tomaten — ON SALE Edeka €1.29, vegetable broth, spices), 5 preparation steps, and "Open original recipe ↗" linking to allrecipes.com. He confirms it is feasible and keeps it.

**2. Cached recipe — source link dead**
The recipe database has a cached version of "Tomato Rice Bowl" but the original URL returns a 404. The panel shows the cached ingredient list and steps with a note: "Original source unavailable — showing saved version." Dimitar can still cook from the cached data.

**3. No recipe found**
The meal planner suggested "Gouda Pasta Bake" but no matching recipe exists in the recipe source. The panel shows only the ingredient list with a message: "Recipe not found — search manually" and a pre-filled Google search link. Dimitar searches and finds one in 20 seconds.

#### UAT Scenarios (BDD)

```gherkin
Scenario: Dimitar views a recipe for a meal in his plan
  Given a 7-day meal plan has been generated
  And the plan contains a meal with a matched recipe
  When Dimitar clicks on a meal title
  Then a recipe detail view opens
  And the ingredient list shows which items are currently on sale and at which store
  And preparation steps are shown
  And a link to the original recipe source is displayed

Scenario: Recipe displayed from cache when source URL is unavailable
  Given a recipe's original source URL returns a 404 error
  When Dimitar clicks on the meal linked to that recipe
  Then the cached recipe content (ingredients and steps) is shown
  And a notice states "Original source unavailable — showing saved version"

Scenario: No recipe available for a planned meal
  Given the meal planner selected a meal with no matched recipe
  When Dimitar clicks on that meal
  Then the ingredient list is shown
  And a message "Recipe not found — search manually" is displayed
  And a link to a pre-filled web search for that meal name is provided
```

#### Acceptance Criteria
- [ ] Clicking any meal title opens a recipe detail view without full page reload
- [ ] Ingredient list highlights items that are in this week's discount feed, including store name and sale price
- [ ] Original recipe source link opens in a new tab
- [ ] If source URL is dead, cached content is shown with a "unavailable" notice
- [ ] If no recipe exists, ingredient list is shown with a manual search link
- [ ] "Back to meal plan" navigation is always visible

#### Outcome KPIs
- **Who**: Dimitar
- **Does what**: Verifies meal feasibility directly from the plan without leaving the app to search for recipes
- **By how much**: Eliminates recipe-hunting step from meal planning workflow (from external search to in-app)
- **Measured by**: Presence of recipe link click events in logs
- **Baseline**: External Google search per meal (4-7 min per unknown meal)

#### Technical Notes
- Recipe source: search engine API query → top result URL → fetch page → parse schema.org/Recipe JSON-LD; SPIKE-02 selects API and validates JSON-LD coverage
- Caching strategy required to handle dead source URLs (show cached content, flag as unavailable)
- LLM on-demand recipe regeneration: future feature; not in SLICE-05 scope
- `job_id`: JOB-001

---

### US-04: View weekly and monthly savings

**Job**: JOB-002
**Slice**: SLICE-01 (single week, basic) → SLICE-04 (history)
**MoSCoW**: Must Have

#### Problem
Dimitar is using the app to save money but has no concrete proof that the discount-first approach is working. Without seeing the accumulated savings, he has no motivation to maintain the habit. "I probably saved something" is not satisfying.

#### Who
- Dimitar Apostolov | After using the app for one or more weeks | Needs concrete financial evidence that planning around discounts is worth the habit

#### Elevator Pitch
Before: Dimitar feels vaguely that discount shopping saves money but has no number to confirm it — motivation to maintain the habit decays without reinforcement.
After: navigate to the Savings tab at `http://localhost/savings` → sees "This week: SAVED €8.40 (paid €12.33, would have paid €20.73)" and a growing history list for previous weeks.
Decision enabled: Dimitar decides whether the app is delivering enough value to continue using it, and which stores/items are providing the most savings.

#### Domain Examples

**1. First week — single data point**
Dimitar finishes his first week using the app. Savings tab shows: "Week of 14 Jul: items on discount — 7, total paid €12.33, regular price €20.73, SAVED €8.40." History section reads "This is your first week — history will grow over time."

**2. Month with 4 weeks of data**
After 4 weeks: Savings tab shows: "Week of 14 Jul: €8.40 | Week of 7 Jul: €11.20 | Week of 30 Jun: €9.80 | Week of 23 Jun: €7.60. Month total: €37.00. Projected annual: €1,924." Dimitar feels the effort is justified.

**3. Week with no regular price data**
The scraper for a given week failed to capture regular prices (only sale prices stored). Savings tab for that week shows: "Savings comparison unavailable this week — regular prices were not captured." It does not show a misleading €0 saved figure.

#### UAT Scenarios (BDD)

```gherkin
Scenario: Dimitar views savings after his first week
  Given a meal plan was generated and the discount feed included regular prices for all items
  When Dimitar navigates to the Savings tab
  Then this week's savings total is displayed in euros
  And the comparison shows total paid (sale prices) vs total regular prices
  And a message indicates this is the first week if no prior history exists

Scenario: Savings history accumulates across multiple weeks
  Given Dimitar has used the app for at least 3 weeks with discount data captured each week
  When he views the Savings tab
  Then the history section shows one entry per week with individual savings amounts
  And a month-to-date total is displayed as the sum of completed weeks in the current month

Scenario: Missing regular price data is displayed honestly
  Given the scraper for the current week did not capture regular prices
  When Dimitar views the Savings tab for that week
  Then a message states "Savings comparison unavailable — regular prices not captured this week"
  And no misleading savings amount is shown for that week

Scenario: Regular price data persists beyond the promotional period
  Given a discounted item's promotional period has ended
  And the item is no longer on sale at the store
  When Dimitar views the Savings tab for the week when that item was on sale
  Then the savings amount for that week is still displayed using the originally captured regular price
  And the savings calculation does not change after the promotion ends
```

#### Acceptance Criteria
- [ ] Savings tab shows this week's: total paid at sale prices, total at regular prices, savings amount (€), count of discounted items used
- [ ] History list shows one entry per week with savings amount
- [ ] Month-to-date total is computed from history entries in the current calendar month
- [ ] When regular prices were not captured, an honest "unavailable" message replaces the savings figure
- [ ] Regular price is captured and stored at scrape time, not derived later

#### Outcome KPIs
- **Who**: Dimitar
- **Does what**: Reviews concrete weekly savings amount after each plan cycle
- **By how much**: Savings tracker shows ≥€20 saved per month after the first 4-week period
- **Measured by**: savings_log table cumulative total; self-reported at 1-month review
- **Baseline**: €0 tracked savings (no tracking tool exists)

#### Technical Notes
- `savings_log` table must persist `regular_price` separately from current store price
- Savings calculation: SUM(regular_price - sale_price) for items in the meal plan week
- Projected annual figure is optional / later enhancement
- `job_id`: JOB-002

---

### US-05: Configure dietary restrictions

**Job**: JOB-003
**Slice**: SLICE-03
**MoSCoW**: Must Have

#### Problem
Dimitar is vegetarian. If the meal plan includes meat or fish — even once — he cannot eat it and the plan is useless. He needs a persistent, easy-to-update restriction setting that applies automatically without requiring him to review every generated meal.

#### Who
- Dimitar Apostolov | First-time app setup OR when dietary needs change | Needs to set a restriction once and trust it will be applied everywhere

#### Elevator Pitch
Before: Dimitar must manually review every generated meal to check for meat — a tedious, error-prone review step that defeats the purpose of automation.
After: navigate to Settings at `http://localhost/settings` → see a "Dietary Restrictions" field, select "vegetarian" from a dropdown, click Save → future meal plans automatically exclude meat and fish with no manual review needed.
Decision enabled: Dimitar decides which restriction profile fits his current needs and trusts it will be applied to all future plans without further intervention.

#### Domain Examples

**1. Happy path — initial setup**
First time Dimitar opens the app. Settings page shows "Dietary Restrictions: None (default)." He selects "vegetarian" from the dropdown and clicks Save. A confirmation toast reads "Settings saved. Meal plans will now exclude meat and fish." The next plan generated contains zero meat items.

**2. Edge case — changing restrictions**
Dimitar temporarily removes his vegetarian restriction for a week (family dinner planning with non-vegetarian meals). He changes settings to "None." Next plan includes meat options. The following week he restores "vegetarian." History savings records are not affected by the restriction change.

**3. Restriction results in empty plan**
Dimitar adds an unusual restriction (e.g., "gluten-free AND vegetarian"). Generated plan finds 0 compatible discounted items. Settings page shows: "Your current restrictions produced no compatible meals last week. Consider reviewing your restrictions." No silent failure.

#### UAT Scenarios (BDD)

```gherkin
Scenario: Dimitar sets a vegetarian dietary restriction for the first time
  Given Dimitar has no dietary restriction currently set
  When he navigates to Settings and selects "vegetarian" and clicks Save
  Then a confirmation message "Settings saved" is displayed
  And when a new meal plan is generated, no meal contains meat or fish

Scenario: Changing dietary restriction takes effect on the next plan generation
  Given Dimitar's restriction is currently "vegetarian"
  When he changes the restriction to "none" and saves
  And generates a new meal plan
  Then the new plan may include meals with meat ingredients
  And the previous week's savings history is unaffected

Scenario: Settings page loads with current restriction pre-selected
  Given Dimitar has previously set his restriction to "vegetarian"
  When he navigates to the Settings page
  Then the "vegetarian" option is pre-selected in the Dietary Restrictions field

Scenario: User is warned when restrictions produce no compatible meals
  Given Dimitar's restrictions are "gluten-free AND vegetarian"
  And the current discount feed contains no gluten-free vegetarian items
  When Dimitar generates a meal plan
  Then a message explains "No compatible meals found with your current restrictions"
  And a direct link to the Settings page is shown
```

#### Acceptance Criteria
- [ ] Settings page has a Dietary Restrictions field with at minimum: None, Vegetarian, Vegan options
- [ ] Selected restriction persists across browser sessions
- [ ] Settings change triggers a toast confirmation "Settings saved"
- [ ] Restriction is applied automatically to every subsequent meal plan generation
- [ ] When a restriction causes zero compatible meals, an explanatory message with a link to Settings appears
- [ ] Restriction change does NOT retroactively modify past savings history records

#### Outcome KPIs
- **Who**: Dimitar
- **Does what**: Configures dietary restriction once and never manually reviews meal plans for compliance
- **By how much**: Zero meal plan entries violating dietary restrictions per week (100% filter compliance)
- **Measured by**: Count of manually rejected meals per week (target: 0)
- **Baseline**: Currently 100% manual review required (all meals checked individually)

#### Technical Notes
- user_settings table: single-row for single-user app; dietary_restrictions stored as array/enum
- restriction options: None, Vegetarian, Vegan (extensible in DESIGN wave for allergens etc.)
- `job_id`: JOB-003

---

### US-06 (@infrastructure): Weekly scraper scheduler

**Job**: infrastructure-only
**Slice**: SLICE-01
**MoSCoW**: Must Have

#### @infrastructure tag
This story has no direct user-visible entry point. It is a precondition for US-01 (discount feed) to have data.

**Infrastructure rationale**: The scraper scheduler is pure backend infrastructure. Users never invoke it directly. However, it is a required precondition for US-01 (discount feed). It is included in SLICE-01 alongside US-01 (a user-visible story) per the hard gate: slices containing only `@infrastructure` stories are blocked. This story co-lands with US-01.

#### Problem
Without a scheduled scraper, the discount feed database is never populated. US-01 through US-04 have no data to display.

#### Technical Notes
- Scheduled weekly (Monday ~05:00-06:00 to align with flyer cycle reset)
- Scrapes Aldi Süd, Edeka, V-Markt (SLICE-01: Aldi Süd only)
- Stores: item name, sale price, regular price, store name, valid_until date, scrape_timestamp
- On failure: logs error, retains last-known data, marks data as stale
- Scraping feasibility validated in post-DISCUSS SPIKE before architecture committed
- `job_id`: infrastructure-only
- `infrastructure_rationale`: Pure backend scheduler with no user-visible surface; required pre-condition for US-01 (discount feed) which IS user-visible. Co-lands with US-01 in SLICE-01.

---

## Wave: DISCUSS / [REF] Out of Scope

- Multi-user support / authentication (single-user app)
- Budget setting / spending limits (future release)
- Shopping list export / print (future — mentioned in journey mockup but not in core jobs)
- Price comparison across stores for non-discounted items (out of scope: discount-first only)
- Mobile app (web first; responsive layout is sufficient for v1)
- More cities / additional supermarkets (architecture must SUPPORT it; MVP is Munich only)
- Meal planning for non-standard periods (e.g., 3-day or 14-day) — 7-day only in MVP
- LLM-generated recipes (future good-to-have: on-demand recipe regeneration when Dimitar dislikes a suggestion; v1 uses search engine → real recipe sites)

---

## Wave: DISCUSS / [REF] Driving Ports (Inbound Surfaces)

- `http://localhost/` — Discount dashboard (US-01)
- `http://localhost/plan` — Meal plan view (US-02)
- `http://localhost/plan/{meal_id}` — Recipe detail (US-03)
- `http://localhost/savings` — Savings tracker (US-04)
- `http://localhost/settings` — User settings / dietary restrictions (US-05)
- Background scheduler — Weekly scraper (US-06, @infrastructure)

---

## Wave: DISCUSS / [REF] Pre-requisites

- **SPIKE (post-DISCUSS, before DESIGN)**: Validate HTML scraping feasibility for Aldi Süd, Edeka, V-Markt. Confirm whether JS rendering is required (Playwright/Puppeteer), identify rate-limiting / anti-bot measures, assess legal risk of scraping product data.
- **SPIKE-02 (post-DISCUSS, before DESIGN)**: Validate Brave Search API for recipe lookup. Confirm free tier (2,000 queries/mo) covers personal-use volume. Test `"{ingredient} vegetarian recipe"` queries with German ingredient names (e.g., "Rote Linsen vegetarisch Rezept") and verify top results carry `schema.org/Recipe` JSON-LD. Identify 2-3 target recipe sites (AllRecipes, BBC Good Food, Chefkoch). If Brave result quality is poor for German terms, evaluate Bing Search API as fallback. DuckDuckGo excluded (no public search API).

---

## Wave: DISCUSS / [REF] Definition of Ready (9-Item Checklist)

| # | Item | Evidence |
|---|------|----------|
| 1 | Problem statement clear, domain language | Each US has a "Problem" section in Dimitar's vocabulary |
| 2 | User/persona identified with specific characteristics | Dimitar Apostolov, vegetarian software engineer, Munich |
| 3 | 3+ domain examples with real data | US-01 through US-05 each have 3 examples with Munich prices and real item names |
| 4 | UAT scenarios in Given/When/Then (3-7 per story) | 3-4 scenarios per story, all in Gherkin format |
| 5 | AC derived from UAT | AC bullet points per story, all traceable to scenarios |
| 6 | Right-sized (≤1 day per slice, 3-7 scenarios per story) | 5 slices × ≤1 day; 3-4 scenarios per story |
| 7 | Technical notes identify constraints | Each story has Technical Notes section |
| 8 | Dependencies resolved or tracked | Post-DISCUSS SPIKEs for scraping and recipes explicitly listed |
| 9 | Outcome KPIs defined with measurable targets | Per-story KPIs with numeric targets and measurement methods |

### DoR Status: PASSED

---

## Wave: DISCUSS / [REF] Definition of Done (Completion Checklist)

Populated at DESIGN/DELIVER wave completion — not DISCUSS scope. Stubbed here to complete the checklist pair.

| # | Item | Status |
|---|------|--------|
| 1 | All UAT scenarios pass in CI | Not yet (pre-DESIGN) |
| 2 | Code merged to main branch | Not yet |
| 3 | App deployed to local environment | Not yet |
| 4 | Feature demoable to Dimitar end-to-end | Not yet |

---

## Wave: DISCUSS / [REF] Requirements Completeness

**Completeness Score: 0.97**

Scoring basis (functional coverage):

| Coverage Dimension | Count | Notes |
|---|---|---|
| User-visible jobs covered | 3/3 (JOB-001, 002, 003) | All opportunity-scored jobs have at least one story |
| Backbone activities with stories | 5/5 (Fetch, Filter/Plan, Recipes, Savings, Settings) | Recipe stub in S01 preserves coverage; engine in S05 |
| Failure/error paths documented | 4/4 (stale data, no compatible items, dead recipe URL, no regular price) | All paths have "Then" clauses in UAT scenarios |
| Shared artifacts with source documented | 7/7 | All in shared-artifacts-registry.md |
| NFRs captured as guardrail KPIs | 3 (scraper >90% success, plan generation <5s, 0 dietary violations) | Outcome KPIs Summary — Guardrail Metrics |
| Business rules as explicit decisions | 10 (D1–D10) | All locked in Locked Decisions section |

Deductions (−0.03): Two architectural decisions (scraping approach, recipe source) are solution-neutral stubs deferred to SPIKEs. This is correct behaviour for DISCUSS wave but leaves implementation constraints incompletely specified until SPIKE-01 and SPIKE-02 complete.

---

## Wave: DISCUSS / [REF] Outcome KPIs Summary

### Feature Objective
Within 4 weeks of first use, Dimitar's weekly grocery spend has measurably decreased compared to unplanned shopping, and he has evidence of that decrease in the app.

### KPI Table

| # | Who | Does What | By How Much | Baseline | Measured By | Type |
|---|-----|-----------|-------------|----------|-------------|------|
| 1 | Dimitar | Opens app instead of browsing 3 supermarket websites on Monday | Browsing time <2 min vs 30-45 min baseline | 30-45 min/week | Self-reported at 4-week check | Leading |
| 2 | Dimitar | Generates and follows a discount-driven meal plan | ≥3 weeks of plan adoption in first month | 0 weeks (no tool) | `meal_plans` table row count per week | Leading |
| 3 | Dimitar | Sees confirmed weekly savings amount | ≥€20 saved/month after 4 weeks | €0 tracked (no tool) | `savings_log` table cumulative total | Leading |
| 4 | Dimitar | Uses a meal from the plan without manually checking recipe compatibility | 0 dietary violations per week | N/A (manual review) | Manual violation count self-reported | Leading |

### Metric Hierarchy
- **North Star**: Cumulative monthly savings amount (€) — leading indicator of value delivered
- **Leading Indicators**: Weekly plan adoption rate; browsing time saved; dietary filter compliance rate
- **Guardrail Metrics**: Scraper success rate (must not drop below 90% of weeks); plan generation time (<5 seconds); no dietary violations

### Hypothesis
We believe that generating a discount-first weekly meal plan with savings tracking for Dimitar will result in measurable grocery cost reduction. We will know this is true when Dimitar's savings_log shows ≥€20 saved per month after 4 consecutive weeks of use.

---

## Wave: DISCUSS / [REF] Wave Decisions

Key decisions made during DISCUSS:
- [D1] JTBD = YES: all stories trace to jobs.yaml (JOB-001 / JOB-002 / JOB-003)
- [D2] Feature type = Cross-cutting: 4 bounded contexts, 5 slices
- [D3] Walking skeleton = SLICE-01 (Aldi Süd only, 1 meal, 1 saving)
- [D4] UX depth = Lightweight (single persona = owner; brief journey map sufficient)
- [D5] Slicing = Elephant Carpaccio ≤1 day per slice
- [D6] Scraping SPIKE deferred post-DISCUSS (critical risk)
- [D7] Recipe source = search engine API → top result → schema.org/Recipe JSON-LD extraction; LLM generation deferred to future iteration
- [D8] Regular price MUST be captured at scrape time (savings tracking invariant)
- [D9] Single-user app: no auth, no multi-tenancy
- [D10] Locale extensibility: architecture must support; Munich-only MVP

Primary jobs: discount-first weekly grocery planning + savings tracking + dietary-restriction compliance
Walking skeleton: Aldi Süd scrape → 1 discounted item → 1-meal plan → €X.XX saved displayed
Feature type: Cross-cutting (backend scraper + recipe engine + frontend meal plan + savings UI)

Constraints established:
- Regular price persists beyond promotional period (savings tracking invariant)
- Dietary filter applied before meal generation (not as post-filter)
- Only items with BOTH `price` (regular) AND `discountedPrice` (sale) are scraped — ~20% of catalogue (~31 items/week); sufficient for a 7-day meal plan
- No Playwright needed: prospekt.aldi-sued.de serves plain HTTP JSON; slug discovered via HEAD → 302

Upstream changes: None (greenfield; no prior waves to back-propagate from)

DIVERGE absent: risk noted. No DIVERGE wave ran. Design direction selection (scraping approach, recipe source) is deferred to post-DISCUSS SPIKEs. This is the primary risk to DESIGN wave handoff timing.

---

## Wave: DISCUSS / [REF] Expansion Triggers Assessed (ask-intelligent mode)

Evaluating DISCUSS-specific triggers:

| Trigger | Fires? | Reason |
|---------|--------|--------|
| AC ambiguity | NO | Each AC is scoped to one verifiable outcome |
| Cross-context complexity | YES | 4 bounded contexts: scraper, discount/pricing, recipe matching, savings tracking |
| Multi-stakeholder need | NO | Single persona (Dimitar) |
| Compliance / regulatory | NO | No GDPR/PII/regulatory ACs present |
| WS strategy = D | NO | Strategy A (vertical slice) |

One trigger fires (cross-context complexity). Suggested expansion: `alternatives-considered` (decision rationale for scraping approach and recipe source — which alternatives were weighed). This expansion is appropriate for the post-DISCUSS DESIGN wave, not for DISCUSS output. Deferring to DESIGN wave as SPIKE input context.

No expansion menu emitted (triggered expansion is already captured in wave-decisions.md D6/D7 and SPIKE pre-requisites).

---

## Wave: DESIGN / [REF] Design Decisions Summary

Full detail in `docs/product/architecture/brief.md`. Summary of D11–D35:

| ID | Decision | Verdict |
|----|----------|---------|
| D11 | Process topology | Modular monolith — one Bun HTTP process |
| D12 | Scheduler | OS cron / systemd timer — Monday 06:00 CET |
| D13 | Database | SQLite (WAL mode) — `discount-hunt.db` |
| D14 | Recipe cache | Same SQLite DB, `recipes` table, 7-day TTL |
| D15 | Deployment | Bare process (default) or Docker Compose |
| D16 | Locale extensibility | `store` column + per-store scraper module |
| D17 | Runtime | Bun TypeScript (SPIKE-validated) |
| D18 | Scraper invocation | One-shot script `bun run scrape.ts` |
| D19 | Bounded context count | 6 contexts (DISCUSS had 4; Meal Planning + User Preferences surfaced explicitly) |
| D20 | Core subdomain | Meal Planning |
| D21 | DiscountItem ownership | Discount/Pricing context owns aggregate; Catalogue Scraping is ACL |
| D22 | regular_price immutability | Write-once at scrape time; no UPDATE command on this field |
| D23 | estimated_savings consistency | `meal_plans.estimated_savings` + `savings_log.saved_amount` written in same SQLite transaction |
| D24 | SavingsRecord immutability | Prior weeks immutable; current week replaceable via `ReplaceSavings` |
| D25 | MealPlan dietary_filter snapshot | Captured at generation time; not retroactively altered by settings changes |
| D26 | Context boundary enforcement | Logical module boundaries (`src/{context}/`); no cross-context imports except Shared Kernel |
| D27 | ES / CQRS | Not warranted — 1 user, no concurrency, no audit regulation |
| D28 | Domain events | Named for ubiquitous language; realized as direct in-process calls |
| D29 | HTTP server | `Bun.serve` built-in |
| D30 | ORM + migrations | Drizzle ORM + Drizzle Kit |
| D31 | Frontend | Server-rendered HTML + HTMX (no build step) |
| D32 | Test framework | Bun test built-in |
| D33 | Dietary filter | `isCompatible()` Shared Kernel in `src/shared/dietary.ts` |
| D34 | Architectural linting | `dependency-cruiser` pre-commit + CI |
| D35 | Composition root | `src/server.ts` — wire → probe → register routes |
| D36 | Recipe rotation window | 4-week exclusion (`RECIPE_ROTATION_DAYS = 28`) enforced in `GeneratePlan` via `getRecentRecipeIds(since)` |
| D37 | Plan generation contract shape | `generatePlan()` pure computation → value; `savePlan()` only impure function (D23 transaction write) |

Architecture pattern: **modular monolith with hexagonal architecture (ports-and-adapters)**
Paradigm: **OOP** (TypeScript classes for services and adapters; pure functions at domain boundaries)

---

## Wave: DESIGN / [REF] Reuse Analysis

| Proposed Component | File | Overlap | Decision | Justification |
|---|---|---|---|---|
| Dietary predicate | `src/shared/dietary.ts` | 3 BCs consume dietary compatibility | Shared Kernel (single function) | Three independent impls = guaranteed divergence; structural non-representability |
| Drizzle schema | `src/shared/schema.ts` | All 5 adapter impls need table defs | Single shared schema | DRY on column definitions; no domain logic leaks |
| SQLite client | `src/shared/db.ts` | All 5 secondary adapters need DB connection | Single factory | Multiple clients = WAL locking; one connection is correct SQLite pattern |
| Scrape-time tag classifier | `src/scraping/adapters/catalogue-normalizer.ts` | Produces tags consumed by `isCompatible()` | Separate from predicate | Different responsibility: tag production vs compatibility check; different invocation time |
| `estimated_savings` computation | `src/meal-planning/plan-service.ts` | Appears in plan footer + savings tracker | Single computation site + same-transaction write | Separate computation = consistency gap; structural guarantee by construction |
| Recipe HTML fetcher | `src/recipe/adapters/chefkoch-recipe-fetcher.ts` | Only Chefkoch in S05; future sites use same port | Single file per site under `RecipeFetcher` port | Swappable adapters; `recipe-service.ts` unchanged when adding sites |

---

## Wave: DESIGN / [REF] Open Questions

| # | Question | Deferred to | Risk |
|---|----------|-------------|------|
| OQ-1 | Brave Search API key validation — SPIKE-02 could not test live API with real key | DISTILL / SLICE-05 | MEDIUM — Chefkoch site search is validated fallback; Brave adds quality improvement |
| OQ-2 | Edeka and V-Markt scraping feasibility — not spiked | SLICE-02 spike | MEDIUM — only Aldi Süd validated; block SLICE-02 until confirmed |
| OQ-3 | `servicePoint` / store code for Munich V-Markt and Edeka — not confirmed | SLICE-02 | LOW — catalogue endpoints may not require store-specific codes |
| OQ-4 | Dietary keyword classifier coverage — `catalogue-normalizer.ts` classifier is placeholder | SLICE-03 acceptance tests | LOW — property-based tests will surface gaps before SLICE-03 lands |
| OQ-5 | Docker overlayfs SQLite fsync — relevant only if deployed in Docker | Platform (DEVOPS wave) | LOW — bare process default avoids this; Docker Compose is optional |

---

## Wave: DISTILL / S01 Walking Skeleton

*Appended after DESIGN wave. Scope: S01 only — 2 scenarios (walking skeleton + error path).*

### [REF] Inherited Commitments

| Commitment | Source | Binding constraint |
|-----------|--------|-------------------|
| Bun TypeScript runtime | D17 | Test framework = `bun test`; import from `bun:test` |
| `bun test` built-in | D32 | No cucumber-js; use `describe`/`test`/`expect`/`beforeAll`/`afterAll` |
| Hexagonal / ports-and-adapters | D26 | Tests invoke driving ports only; no direct service calls |
| Composition root | D35 | `src/server.ts` is the SUT entry point; `createServer({port, dbPath})` exported for tests |
| regular_price immutability | D22 | Happy-path fixture must have `price > discountedPrice`; assert both in HTML |
| same-transaction write | D23 | `estimated_savings` in plan HTML must equal `saved_amount` in savings HTML |
| SavingsRecord immutability | D24 | Error path: no savings_log rows when no discount items exist |
| both-price filter | D21 | Error-path fixture has price-only items; normalizer discards all; UI shows empty state |
| `isCompatible()` Shared Kernel | D33 | Dietary filter applied in S03; S01 uses default "none" restriction |
| OQ-1 deferred | DESIGN OQ | `FakeBraveSearchClient` injected; recipe service returns stub URL in S01 |

### [REF] Wave-Decision Reconciliation

Reconciliation passed — 0 contradictions across DISCUSS (D1–D10) / DESIGN (D11–D37) / DEVOPS (absent — greenfield default).

SPIKE-01 note: binary verdict "requires Playwright" superseded by SPIKE-01 addendum (`prospekt.aldi-sued.de`, plain HTTP). DESIGN D6 already adopted the addendum findings. No contradiction.

### [REF] Scenario List

| # | Scenario | Tags | Status |
|---|---------|------|--------|
| 1 | Shopper sees discounted items, generates a meal plan, and confirms savings match the estimate | `@walking_skeleton @s01 @real_io @contract-shape:bounded-change` | ENABLED |
| 2 | Shopper sees an empty discount feed when catalogue contains no items with both prices | `@walking_skeleton @s01 @real_io @contract-shape:bounded-change @skip` | SKIPPED — enable after Scenario 1 GREEN + committed |

Tier B: NOT declared. Journey has 2 scenarios — below ≥3 threshold for state-machine PBT.

### [REF] Walking Skeleton Strategy

| Dimension | Decision |
|-----------|---------|
| WS strategy | Vertical slice — full E2E path, no mocks at the HTTP boundary |
| User value demonstrated | Shopper can view discount items with prices AND generate a plan AND verify savings match |
| Observable outcomes | (1) discount feed HTML contains item names + both prices; (2) plan HTML contains estimated savings; (3) savings tracker HTML contains matching saved_amount |
| SUT entry points | CLI: `Bun.spawnSync(["bun", "run", "src/scraping/scraper-runner.ts"])` | HTTP: `fetch("http://localhost:{port}/")` via `createServer()` |
| Fail-for-right-reason classification | Deferred to DELIVER PREPARE (post `bun install`); scaffolds throw `"Not yet implemented — RED scaffold"` — BROKEN until module graph resolves |

### [REF] CLI Subprocess Fake-Injection Seam

The CLI scraper runs as a real subprocess (`Bun.spawnSync`). The fake Aldi catalogue is injected via environment variables:

| Env var | Value in tests | Effect |
|---------|---------------|--------|
| `CATALOGUE_SOURCE` | `"fake"` | `scraper-runner.ts` selects `FakeAldiCatalogueAdapter` instead of `AldiSudCatalogueFetcher` |
| `FAKE_CATALOGUE_FIXTURE` | `/tmp/.../catalogue-fixture.json` | Path to fixture JSON written by the test |
| `TEST_DB_PATH` | `/tmp/.../test.db` | Shared SQLite file path for subprocess scraper + in-process HTTP server |

This keeps the CLI driving-adapter test real (actual subprocess + exit code) while eliminating live network I/O in CI.

### [REF] Adapter Coverage

| External port | Test mechanism | Fixture shape |
|--------------|---------------|--------------|
| Aldi catalogue HTTP (`CatalogueFetcher`) | `FakeAldiCatalogueAdapter` — file-backed fixture (subprocess seam) | `{ id, title, brand, price, discountedPrice, customLabel1, productType, photoUrls }` — SPIKE-01 addendum shape |
| Chefkoch recipe fetcher (`RecipeFetcher`) | `FakeChefkochFetcher` — S01 plan-service uses hardcoded stub URL | N/A in S01 |
| Brave Search (`RecipeSearchClient`) | `FakeBraveSearchClient` — OQ-1 deferred to S05 | N/A in S01 |

### [REF] Driving Adapter Coverage

| Driving port | Tested | Mechanism |
|-------------|--------|-----------|
| `GET /` (discount feed) | YES | `fetch(baseUrl + "/")` against real `Bun.serve` |
| `POST /plan/generate` | YES | `fetch(baseUrl + "/plan/generate", { method: "POST" })` |
| `GET /savings` | YES | `fetch(baseUrl + "/savings")` |
| `CLI bun run scrape.ts` | YES | `Bun.spawnSync(...)` capturing exit code |
| `GET /plan` | YES | `fetch(baseUrl + "/plan")` (redirect target after generate) |

### [REF] Scaffolds Created

| File | Type | Note |
|------|------|------|
| `src/shared/types.ts` | RED scaffold | `DietaryTag`, `DietaryRestriction`, `WeekStart`, `Money`, branded IDs, `NormalizedItem` |
| `src/shared/db.ts` | RED scaffold | `createDb(path): DbClient` — WAL probe stub |
| `src/shared/schema.ts` | RED scaffold | Drizzle table definitions — placeholder exports |
| `src/shared/dietary.ts` | RED scaffold | `isCompatible(tags, restriction): boolean` — Shared Kernel pure fn |
| `src/server.ts` | RED scaffold | `createServer({port, dbPath}): ServerHandle` — composition root |
| `src/scraping/scraper-runner.ts` | RED scaffold | CLI entry point; reads `CATALOGUE_SOURCE` / `FAKE_CATALOGUE_FIXTURE` / `TEST_DB_PATH` |
| `src/scraping/scraping-service.ts` | RED scaffold | `ScrapingService.run()` |
| `src/scraping/adapters/aldi-sud-catalogue-fetcher.ts` | RED scaffold | `AldiSudCatalogueFetcher` |
| `src/scraping/adapters/catalogue-normalizer.ts` | RED scaffold | `CatalogueNormalizer.normalize()` + both-price filter |
| `src/scraping/adapters/sqlite-scrape-job-repository.ts` | RED scaffold | `SQLiteScrapeJobRepository` |
| `src/scraping/probes/catalogue-probe.ts` | RED scaffold | `CatalogueProbe.run()` |
| `src/discount/http/discount-handler.ts` | RED scaffold | `DiscountHandler.handleGet()` |
| `src/discount/discount-service.ts` | RED scaffold | `DiscountService.registerDiscountItem()` + `getWeeklyItems()` |
| `src/discount/adapters/sqlite-discount-item-repository.ts` | RED scaffold | `SQLiteDiscountItemRepository` |
| `src/meal-planning/http/plan-handler.ts` | RED scaffold | `PlanHandler.handleGetPlan()` + `handlePostGenerate()` |
| `src/meal-planning/plan-service.ts` | RED scaffold | `PlanService.generatePlan()` (pure) + `savePlan()` (same-tx write) |
| `src/meal-planning/adapters/sqlite-meal-plan-repository.ts` | RED scaffold | `SQLiteMealPlanRepository` |
| `src/savings/http/savings-handler.ts` | RED scaffold | `SavingsHandler.handleGet()` |
| `src/savings/savings-service.ts` | RED scaffold | `SavingsService.getHistory()` + `recordSavings()` + `replaceSavings()` |
| `src/savings/adapters/sqlite-savings-repository.ts` | RED scaffold | `SQLiteSavingsRepository` |
| `src/recipe/recipe-service.ts` | RED scaffold | `RecipeService.getRecipe()` — stub URL in S01 |
| `src/recipe/adapters/sqlite-recipe-repository.ts` | RED scaffold | `SQLiteRecipeRepository` |
| `tests/acceptance/support/fake-aldi-catalogue-adapter.ts` | RED scaffold | `FakeAldiCatalogueAdapter` + `CatalogueItem` interface |
| `tests/acceptance/support/test-db.ts` | RED scaffold | `createTestDb()` helper |
| `tests/acceptance/support/test-server.ts` | RED scaffold | `startTestServer(dbPath)` helper |

### [REF] Test Placement

| File | Purpose |
|------|---------|
| `tests/acceptance/discount-hunt/walking-skeleton.feature` | Gherkin spec — 2 scenarios (1 enabled, 1 skipped) |
| `tests/acceptance/discount-hunt/walking-skeleton.test.ts` | Executable companion — `bun test` describe/test blocks |
| `tests/acceptance/support/fake-aldi-catalogue-adapter.ts` | Fake port double for CLI subprocess seam |
| `tests/acceptance/support/test-db.ts` | Ephemeral SQLite DB creation helper |
| `tests/acceptance/support/test-server.ts` | HTTP server start/stop helper |
| `docs/architecture/atdd-infrastructure-policy.md` | Project-level ATDD policy (created this wave) |

### [REF] Prerequisites for DELIVER

1. Run `bun install` to install all declared dependencies.
2. Run `bun test tests/acceptance/discount-hunt/walking-skeleton.test.ts` — expect BROKEN (import errors) until module graph resolves.
3. After `bun install`, classify fail mode: BROKEN (import error) → fix scaffold imports; RED (reaches `throw new Error("Not yet implemented")`) → correct fail-for-right-reason, begin DELIVER.
4. DELIVER implements scaffolds one scenario at a time: Scenario 1 first; enable Scenario 2 only after Scenario 1 GREEN + committed.
5. Support helpers (`test-db.ts`, `test-server.ts`) are DELIVER-time refactor targets. `walking-skeleton.test.ts` currently inlines their logic directly (intentional for the walking skeleton). Refactor to consume the helpers when adding Scenario 2 or subsequent acceptance tests so setup code is not duplicated.

### [REF] Mandate-12 Compliance (TypeScript Adaptation Note)

Mandate-12 four-criteria mechanical check (Python pilot) does not map directly to a 2-test Bun TypeScript file. Adaptation:

| Criterion | Python pilot | TypeScript S01 adaptation |
|-----------|-------------|--------------------------|
| CM-I-1: domain types module | `tests/.../steps/domain_types.py` | Types in `src/shared/types.ts` (production Shared Kernel) — domain concepts expressed once in the type system |
| CM-I-2: typed parameters | typed enums from domain_types.py | `DietaryTag`, `DietaryRestriction`, `WeekStart`, `Money` used in all service signatures |
| CM-I-3: step body ≤2 statements | AST check | `walking-skeleton.test.ts` test bodies delegate to `fetch()` + `expect()` — no business logic |
| CM-I-4: step-reuse-ratio | informational, not gated | Natural ceiling for 2-scenario walking skeleton; documented here as informational |

Step-reuse-ratio: 5 unique test functions / 5 unique test calls = 1.0× (natural ceiling for walking skeleton; not a gate per CM-I-4).

### [REF] AT-Completeness Audit (Phase 2.5)

15-item checklist verdict: **ACCEPTABLE_WITH_DOCUMENTED_GAPS (11/15)**

| Item | Result | Note |
|------|--------|------|
| C1a Walking skeleton present | PASS | Scenario 1 |
| C1b Happy-path scenario present | PASS | Scenario 1 |
| C2a State machine modeled (if applicable) | N/A | No state machine in S01 scope |
| C2b State transitions covered | N/A | Simple request-response in S01 |
| C3 Error paths ≥40% | PASS | 1 of 2 scenarios = 50% error path |
| C4a Boundary values present | PASS | Implicit: both-price filter (0 vs N items) |
| C4b Negative boundary | PASS | Scenario 2: price-only items discarded |
| C5a Mode flags / feature flags | N/A | No feature flags in S01 |
| C5b Configuration variants | GAP | `CATALOGUE_SOURCE` env seam documented in policy but not exercised in a dedicated scenario |
| C6a Error contract: user-visible message | PASS | "No discounts available this week" |
| C6b Error contract: data invariant | PASS | No discount_items rows in error path |
| C6c Error contract: system state unchanged | PASS | No savings_log rows in error path |
| C7a Environment matrix | GAP | DEVOPS wave absent; single default env |
| C7b Concurrency / isolation | GAP | Single-user; not applicable in S01 |
| C7c Multi-actor | N/A | Single-user app by design |

Gaps classified:
- C5b: `AT_GAP_IN_DELIVERY_SCOPE` — deferred to S02 when multi-store `CATALOGUE_SOURCE` flag matters
- C7a: `AT_GAP_IN_DELIVERY_SCOPE` — environment matrix deferred to DEVOPS wave
- C7b: N/A for single-user localhost app

---

## Wave: DELIVER / [REF] Demo Evidence

**Date**: 2026-07-14 | **Gate**: Post-Merge Integration (Phase 3.5)

Acceptance suite: **3 pass, 4 skip, 0 fail** (Scenario 2 remains @skip per DISTILL prereq #4 — enable after S01 commit).

### S01 Elevator Pitch Verification

**US-01 — View this week's discount feed (GET /)**
```
Status: 200
Contains item names (Bio Haferflocken, Rote Linsen): true
Contains both prices (2.29 was, 1.49 sale): true
Contains "Generate Meal Plan": true
```
Decision enabled: ✓ Discounts visible with "was" price and sale price.

**US-02 — Generate a discount-driven meal plan (POST /plan/generate → GET /plan)**
```
POST /plan/generate: 200
GET /plan: 200
data-estimated-savings: 210 cents (€2.10)
```
Decision enabled: ✓ Plan generated with estimated savings displayed.

**US-04 — View weekly savings (GET /savings)**
```
Status: 200
data-saved-amount: 210 cents (€2.10)
D23 invariant (plan savings == savings record): true
```
Decision enabled: ✓ Savings tracker shows confirmed amount matching plan estimate.

**US-03** (recipe detail) — deferred to S05 (not in S01 scope).
**US-05** (dietary settings) — deferred to S03 (not in S01 scope).
**US-06** (@infrastructure) — excluded per demo gate rule.
