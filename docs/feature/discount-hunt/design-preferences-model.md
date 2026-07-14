# Design — Household Preferences Model (SLICE-03 redesign)

*Wave: DESIGN — Application Architecture. Author: Morgan (nw-solution-architect). Date: 2026-07-14.*
*Scope: expand the narrow "dietary filter" slice into a four-dimension `user_settings` household-preferences model, then re-slice into honestly-buildable increments.*

Governing principle (Principle 12, Testing-Theater guard): **a setting ships only if changing it produces an observable output change an acceptance test can assert.** Any dimension whose change is unobservable in its slice is DEFERRED with rationale — never shipped inert. This document holds that line for household-size and kid-friendly.

> **Revision (post adversarial review):** the review accepted this design **on the condition that dietary is split into its own increment**. This revision (a) re-slices budget out of increment 1 into a new increment 1.5, isolating its schema/snapshot/regenerate risk; (b) corrects a factual error in the prior draft — `meal_plans.dietary_filter` does **not** already exist and must be ADDED in increment 1 (§1, BLOCKER #2); (c) specifies the port interface explicitly (§3); (d) records the INFO #6 array-vs-enum back-propagation note (§8). Deferral verdicts are unchanged: household=NEEDS-MODEL, kid-friendly=NEEDS-DATA-SOURCE; no inert controls.

---

## 0. The discriminator applied to all four dimensions

| Dimension | Change → observable output? | Data/domain today | Verdict |
|-----------|-----------------------------|-------------------|---------|
| Dietary restriction | none→veg → meat/fish items disappear from plan **and** dashboard | `isCompatible()` READY; `dietary_tags[]` populated at scrape time; `getByWeek(weekStart, restriction)` already filters | **READY — SHIP first (increment 1, dietary ONLY)** |
| Budget cap | low cap → warning banner shows on plan; high/absent cap → no warning | `regular_price`/`sale_price` exist on every item; plan already computes `totalSalePrice` | **READY — ships in increment 1.5** (re-sequenced out of increment 1 to isolate its schema/snapshot/regenerate risk — see §7 increment 1.5) |
| Household size | 2→4 → **nothing changes** (`Meal` = `{day,slot,name,discountItemId}`; no portion/quantity/serving concept anywhere) | No quantity model. Meals are name references, not scaled recipes | **NEEDS-MODEL — DEFER** |
| Kid-friendly | on→off → **nothing changes** (no kid signal in scraped items: store, name, category, prices, validUntil, dietary_tags only) | No honest data source | **NEEDS-DATA-SOURCE — DEFER (spike)** |

The two DEFERRED dimensions are held out deliberately. Rendering a disabled or "coming soon" control for them is itself testing theater (a no-op control that suggests an effect it does not have) and is **out of scope for every increment until its effect is real**.

---

## 1. `user_settings` schema (single-row)

### Net-new confirmation
Verified against `src/shared/db.ts`: the file creates `scrape_jobs`, `discount_items`, `meal_plans`, `savings_log` only. There is **no** `user_settings` table, no preferences repository, no settings route. This is genuinely net-new.

### Migration approach — CREATE TABLE, not ALTER
Because the table does not exist, the migration is a `CREATE TABLE IF NOT EXISTS`, added to `createDb()` in `src/shared/db.ts` alongside the existing `CREATE_*` constants, in the same idempotent style. The ALTER-guard idiom (`try { ALTER TABLE … ADD COLUMN … } catch {}`, as used for the `meals` column) is reserved for **adding columns as their effects ship** — see the columns-arrive-with-effects rule below.

### Columns-arrive-with-effects (honesty rule for schema)
Only columns whose effect is live in the current increment are created. Deferred dimensions get **no column** until their effect ships — a stored-but-never-read column is silent theater. `budget_cap_cents` is therefore **absent from increment 1** and added in increment 1.5 when its warn-effect ships (via the ALTER-guard idiom on `user_settings`); household-size's column arrives with a portion model (increment behind SLICE-05); kid-friendly likewise after its data-source spike.

### Schema at the end of increment 1 (dietary ONLY)

```sql
CREATE TABLE IF NOT EXISTS user_settings (
  user_id             TEXT PRIMARY KEY DEFAULT 'dimitar',   -- single-user constant (D9)
  dietary_restriction TEXT NOT NULL DEFAULT 'none',         -- 'none' | 'vegetarian' | 'vegan'
  updated_at          INTEGER NOT NULL
)
```

| Column | Type | Default | Notes |
|--------|------|---------|-------|
| `user_id` | TEXT PK | `'dimitar'` | Single row; fixed-PK singleton, upsert-on-conflict target (matches D-model line 338) — see §3 Port Interface |
| `dietary_restriction` | TEXT | `'none'` | Single-value enum, not array — see §5 reconciliation and §8 back-propagation note |
| `updated_at` | INTEGER | — | epoch millis; set on every upsert |

Columns **deliberately absent** in increment 1: `budget_cap_cents` (arrives increment 1.5), `household_size`, `kid_friendly` (deferred until their effect is real).

### `meal_plans.dietary_filter` snapshot column — BLOCKER #2 (must be ADDED, does NOT exist)

**Correction to prior draft.** Earlier revisions of this document asserted `meal_plans.dietary_filter` "already exists (D25)." **It does not.** Verified against `src/shared/db.ts`: `CREATE_MEAL_PLANS` (db.ts:48-59) has columns `id, week_start, item_ids, meals, total_regular_price, total_sale_price, estimated_savings, created_at` — **no `dietary_filter`**. The `MealPlan` interface (`sqlite-meal-plan-repository.ts:17-26`) likewise has **no `dietaryFilter` field**. The snapshot the dietary effect relies on must be **added in increment 1**.

Two coordinated edits in `src/shared/db.ts`, both in increment 1:

1. Add the column to the `CREATE_MEAL_PLANS` constant (for fresh databases):

```sql
const CREATE_MEAL_PLANS = `
  CREATE TABLE IF NOT EXISTS meal_plans (
    id TEXT PRIMARY KEY,
    week_start TEXT NOT NULL,
    item_ids TEXT NOT NULL,
    meals TEXT NOT NULL DEFAULT '[]',
    dietary_filter TEXT NOT NULL DEFAULT 'none',   -- NEW (increment 1): snapshotted restriction
    total_regular_price INTEGER NOT NULL,
    total_sale_price INTEGER NOT NULL,
    estimated_savings INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  )
`;
```

2. Add an idempotent guarded `ALTER TABLE` for databases that pre-date the column — following the **exact** pattern already used for the `meals` column (db.ts:87-92):

```ts
// Idempotent migration: add dietary_filter column if the table pre-dates it
try {
  sqlite.exec("ALTER TABLE meal_plans ADD COLUMN dietary_filter TEXT NOT NULL DEFAULT 'none'");
} catch {
  // Column already exists — expected for fresh databases created with the current schema
}
```

`NOT NULL DEFAULT 'none'` guarantees every pre-existing plan is backfilled to the honest historical default (those plans were generated with no restriction).

---

## 2. Per-dimension specification

### 2.1 Dietary restriction — READY

- **Stores**: single enum `none | vegetarian | vegan`.
- **Effect on meal-plan generation**: `plan-service.getOrGenerateCurrentWeekPlan()` reads the restriction from `UserPreferencesRepository.get()` and passes it into `generatePlan(weekStart, items, dietaryFilter)` and into `discountService.getWeeklyItems(weekStart, restriction)` **instead of the hardcoded `"none"` at plan-service.ts:118**. `getByWeek` already applies `isCompatible()`, so non-compliant items never enter the candidate set (unconditional pre-filter, per D33 / Dietary Filter Enforcement §).
- **Snapshot onto the plan**: `generatePlan` writes the passed `dietaryFilter` into the new `meal_plans.dietary_filter` column (added in §1). `MealPlan` gains a `dietaryFilter: DietaryRestriction` field. The plan records **which restriction it was built under** — a fact frozen at generation time (§5).
- **Effect on discount dashboard (LIVE, not snapshot)**: `discount-handler.handleGet()` reads the restriction from the prefs repo on **every request** and passes it into `getWeeklyItems(weekStart, restriction)` **instead of the hardcoded `"none"` at discount-handler.ts:50**. Non-compliant items disappear from the feed immediately. This is the on-demand observable — the dashboard re-filters live the moment the setting changes, with no regenerate step needed. (Contrast budget in §2.2, which has no such live dashboard effect — the architectural reason budget must wait for increment 1.5.)
- **Domain/data needed**: none new — `isCompatible()`, `dietary_tags[]`, and the filtering query all exist and are tested. The one genuinely new schema artifact is the `dietary_filter` snapshot column (§1, BLOCKER #2).
- **Feasibility verdict**: **READY**. Work: add the `dietary_filter` column (CREATE + ALTER-guard), extend `MealPlan`, thread the restriction through `generatePlan`/`getOrGenerateCurrentWeekPlan`, un-hardcode two `"none"` call sites, and source the value from the new repository.

### 2.2 Budget cap — READY but RE-SEQUENCED to increment 1.5

*This dimension is honestly buildable (warn effect), but the adversarial review's core finding was to **isolate it from increment 1**. The analysis below is retained as the design seed for increment 1.5; §7 (increment 1.5) lists its prerequisites. It ships **after** dietary, not with it.*

- **Why split out — the architectural reason (not just sequencing):** dietary has a **live on-demand observable** — the dashboard reads the restriction on every request and re-filters immediately (§2.1). Budget has **no dashboard effect** (the dashboard shows per-item prices, not a plan total), so its *only* observable is the snapshotted plan banner. Because the banner reflects the cap snapshotted at generation time (§5), changing the cap after a plan exists produces **no on-demand observable** — the user sees nothing change until a new plan is generated. Making that honest requires a `POST /plan/regenerate` path (there is no regenerate today; `getOrGenerateCurrentWeekPlan` is idempotent and returns the existing plan unchanged, plan-service.ts:113-116). That regenerate-path design is the extra risk that justifies isolating budget into its own increment.
- **Stores** (increment 1.5): nullable integer cents on `user_settings`. `NULL` = no cap.
- **Effect chosen — WARN, not trim/reject**: at plan render time, if the plan's snapshotted `budget_cap_cents IS NOT NULL` and `totalSalePrice > budget_cap_cents`, the plan page shows a banner: *"This plan costs €X.XX, over your €Y.YY weekly budget."* If the snapshotted cap is NULL or not exceeded, no banner.
- **Timing (snapshot semantics, consistent with D25/dietary)**: the banner reflects the cap **active at plan-generation time**, snapshotted onto the plan — not the live setting. Therefore **setting the cap after a plan already exists does NOT retroactively show a banner**. The observable requires **set-then-regenerate**; hence the `POST /plan/regenerate` prerequisite above.
  - **Trim/reject is explicitly deferred** (beyond 1.5): it would require changing the item-selection algorithm in `plan-service.buildMeals()` (a knapsack-style constrained selection), a real domain change. Warn is the cheapest honest effect. Trim/reject becomes a candidate increment only if warn proves insufficient in dogfooding.
- **Effect on discount dashboard**: **none**. The dashboard shows individual item prices, not a plan total, so a weekly cap has no honest dashboard effect.
- **Domain/data needed**: none new — `totalSalePrice` is already computed in `generatePlan()` (plan-service.ts:53).
- **Feasibility verdict**: **READY (warn effect), scheduled for increment 1.5** — pending the regenerate-path design and snapshot-immutability AT listed in §7 (increment 1.5).

### 2.3 Household size — NEEDS-MODEL (DEFER)

- **What it would store**: number of people a plan must serve (integer ≥ 1).
- **The problem**: a `Meal` is `{ day, slot, name, discountItemId }` — a **name reference to a discounted item**, with no portion, serving, or quantity concept. There is no ingredient-quantity model until recipes (SLICE-05, not built). "Serves 4" has nothing to scale: the plan does not know how much of an item a meal consumes.
- **Honest verdict**: household size cannot produce any observable output change today. Storing it now = an inert column = theater. **DEFER.**
- **What unblocks it**: a portion/quantity model. The natural home is recipes (SLICE-05): once a `Recipe` carries `recipeIngredient[]` with quantities and a base serving count, household size can scale quantities and drive a shopping-quantity or "servings covered" output. Household-size ships **as part of, or immediately after, the recipe/quantity increment** — never before.
- **Feasibility verdict**: **NEEDS-MODEL**.

### 2.4 Kid-friendly — NEEDS-DATA-SOURCE (DEFER, spike)

- **What it would do**: bias or filter plans toward food children will eat.
- **The problem**: scraped items carry `store, name, category, prices, validUntil, dietary_tags` only. **There is no kid-friendliness signal in the data.** Any effect today would be fabricated from data that does not encode the concept.
- **Candidate data sources (none proven — this is the open question)**:
  1. **Category heuristic** — e.g., treat certain `category` values as kid-friendly. Cheap but almost certainly wrong: "kid-friendly" is a taste judgment, not a category; false confidence is worse than no feature.
  2. **Manual tag** — Dimitar tags items/recipes himself. Honest and observable, but shifts the burden to manual curation and needs a tagging UI + storage — a feature in its own right.
  3. **New classifier** — an AI/keyword classifier (like the dietary classifier in `catalogue-normalizer.ts`) that emits a `kid_friendly` tag at scrape time. Plausible, but "will a kid eat this" has no ground-truth keyword list; needs a spike to see if a classifier produces trustworthy tags.
- **Honest verdict**: no honest source exists today. Shipping any of the above without validation = theater. **DEFER behind a data-source spike** (see Open Questions).
- **Feasibility verdict**: **NEEDS-DATA-SOURCE**.

---

## 3. Component impact

All components live in the already-designed `src/preferences/` context (brief §User Preferences) plus two un-hardcoding edits.

| Component | File | Change | Status |
|-----------|------|--------|--------|
| Preferences repository port | `src/preferences/ports/preferences-repository.ts` | NEW — `get(): UserPreferences`, `upsert(prefs): void` (see Port Interface below) | net-new |
| SQLite preferences adapter | `src/preferences/adapters/sqlite-user-preferences-repository.ts` | NEW — single-row upsert-on-conflict on fixed PK `user_id='dimitar'` | net-new |
| Preferences service | `src/preferences/preferences-service.ts` | NEW — thin CRUD: `getPreferences()`, `updatePreferences(...)`; no domain logic | net-new |
| Settings HTTP handler | `src/preferences/http/settings-handler.ts` | NEW — `GET /settings` (form, pre-filled), `POST /settings` (upsert + "Settings saved") | net-new |
| Schema | `src/shared/schema.ts` | ADD `user_settings` Drizzle table def (dietary column only) | edit |
| DB bootstrap — user_settings | `src/shared/db.ts` | ADD `CREATE_USER_SETTINGS` constant + `sqlite.exec(...)` in `createDb()` | edit |
| DB bootstrap — meal_plans snapshot | `src/shared/db.ts` | ADD `dietary_filter TEXT NOT NULL DEFAULT 'none'` to `CREATE_MEAL_PLANS` **and** a guarded `ALTER TABLE meal_plans ADD COLUMN dietary_filter …` per db.ts:87-92 (BLOCKER #2, §1) | edit |
| Types | `src/shared/types.ts` | ADD `UserPreferences` interface (`dietaryRestriction` only in increment 1) | edit |
| MealPlan type | `src/meal-planning/adapters/sqlite-meal-plan-repository.ts` | EXTEND `MealPlan` interface with `dietaryFilter: DietaryRestriction`; map the new column in save/load | edit |
| Plan service (wiring + snapshot) | `src/meal-planning/plan-service.ts` | REPLACE hardcoded `"none"` at line 118 with restriction from prefs repo; inject `UserPreferencesRepository`; extend `generatePlan(weekStart, items)` → `generatePlan(weekStart, items, dietaryFilter)` so the restriction is snapshotted onto the `MealPlan` (still pure, D37); `getOrGenerateCurrentWeekPlan()` reads the restriction and passes it in | edit |
| Discount handler (wiring) | `src/discount/http/discount-handler.ts` | REPLACE hardcoded `"none"` at line 50 with restriction read LIVE from prefs repo; inject `UserPreferencesRepository` | edit |
| Composition root | `src/server.ts` | Wire `SQLiteUserPreferencesRepository` → service → handler; register `/settings` GET+POST; inject prefs repo into plan-service and discount-handler | edit |

*Deferred to increment 1.5 (NOT in increment 1): budget banner render in `src/meal-planning/http/plan-handler.ts`, `budget_cap_cents` columns on `user_settings` and `meal_plans`, and the `budgetCapCents` field on `UserPreferences`/`MealPlan`. See §7 (increment 1.5).*

**Substrate probe (Principle 13):** `SQLiteUserPreferencesRepository` needs **no new probe** — it inherits the shared WAL write-read-delete startup probe in `src/shared/db.ts` (brief §Driven Ports lists all SQLite adapters under "Shared WAL probe"). No probe ceremony is added; the composition-root "wire → probe → use" invariant (D35) already covers this adapter via the shared DB client.

**Port shape (Principle 12 — read/write split not required here):** the preferences port is a genuine read+write CRUD port (settings page writes, plan/dashboard read). It is a single port because the settings handler legitimately needs both. Consumers that only read (plan-service, discount-handler) depend on the port but call only `get()` — acceptable since the port is generic configuration (brief classifies User Preferences as a Generic subdomain with no domain logic).

### Port Interface (WARNING #5)

```
Port: UserPreferencesRepository
  get(): UserPreferences                 // single-row read; returns defaults if the row is unset
  upsert(prefs: UserPreferences): void    // idempotent single-row write

UserPreferences = { dietaryRestriction: DietaryRestriction }
  // increment-1 shape (single enum: 'none' | 'vegetarian' | 'vegan');
  // budgetCapCents added in increment 1.5.
```

- **`get()` — defaults if unset**: if no row exists, `get()` returns `{ dietaryRestriction: 'none' }` (the honest default), never null. Consumers never branch on "is there a row"; the port hides single-row bootstrap.
- **Single-row enforcement — HOW one row is guaranteed**: the table has a **fixed primary key** `user_id` defaulting to the single-user constant `'dimitar'` (D9). `upsert()` writes with that fixed PK using **`INSERT … ON CONFLICT(user_id) DO UPDATE`** (upsert-on-conflict). A second write updates the same row rather than inserting a new one, so the table structurally cannot hold more than one settings row. (`'dimitar'` is the concrete singleton key here; the mechanism — one fixed PK + on-conflict upsert — is what guarantees the invariant.)

---

## 4. Settings page — general "Preferences" page

- Route `GET /settings` renders a **Preferences** page (not a "vegetarian" page), server-rendered HTML (D31), with one field **per live dimension only** — in increment 1 that is exactly one field:
  - **Dietary restriction** — dropdown (None / Vegetarian / Vegan), current value pre-selected from `PreferencesRepository.get()`.
- **No control** for budget (arrives increment 1.5), household size, or kid-friendly until each effect ships (§0). Rendering an inert control is itself theater.
- `POST /settings` upserts the row, then re-renders with a **"Settings saved"** confirmation (toast/banner).
- Pre-selection is sourced live from `PreferencesRepository.get()`.

### Empty-plan warning (carried from original slice)
When the active dietary restriction produces **0 compatible items** for the week, the plan/dashboard shows *"No compatible meals found with your current restrictions"* plus a direct link to `/settings`. This is the US-05 scenario-3/4 behavior and rides in increment 1.

---

## 5. Snapshot decision (per D25)

| Preference | Snapshot vs live | Where | Increment | Rationale |
|------------|------------------|-------|-----------|-----------|
| Dietary restriction | **Snapshot** onto the plan at generation | `meal_plans.dietary_filter` — **NEW column, must be ADDED** (§1, BLOCKER #2; it does **not** already exist despite prior draft's claim) | 1 | A past plan's composition is a fact; changing the restriction later must not retroactively rewrite history (US-05 scenario 2, D25). |
| Budget cap | **Snapshot** onto the plan at generation | NEW `meal_plans.budget_cap_cents` column (nullable) | 1.5 | The warning banner is *about that plan*. If the cap were read live, changing it later would silently flip a past plan's "over budget" banner — inconsistent with D25. Snapshot keeps the banner stable. Deferred with the rest of budget (§2.2, §7 increment 1.5). |

Consequence for increment 1: the dietary restriction is snapshotted onto **each new plan** via `meal_plans.dietary_filter`. The discount **dashboard** reads the restriction **live** (§2.1) — the two are intentionally different: history is frozen, the live feed is not. Budget's snapshot column (`meal_plans.budget_cap_cents`) arrives in increment 1.5.

---

## 6. Testing-theater guard — observable output per field

Explicit assertions an acceptance test can make. A field with no row here is DEFERRED, not shipped.

| Field | Increment | Observable output that proves it works |
|-------|-----------|----------------------------------------|
| Dietary — dashboard filter (LIVE) | 1 | Set `vegetarian` → discount **dashboard shows zero** items with `contains-meat`/`contains-fish` tags **immediately, no regenerate step**. Set back to `none` → **meat items reappear on the next dashboard load**. (Proves the live read path.) |
| Dietary — plan filter (generation) | 1 | Set `vegetarian`, **generate** a plan → **zero meals reference an item with `contains-meat`/`contains-fish` tags**. Set back to `none` → **next-week / regenerated** plan → **meat items return**. (Proves the generation path; reachable via next-week — no regenerate endpoint required in increment 1.) |
| Dietary — snapshot immutability | 1 | After generating a `vegetarian` plan, switch the setting to `none` → the **existing** plan still shows **zero** meat/fish (its `dietary_filter` is frozen at `'vegetarian'`); only a **newly generated / next-week** plan reflects `none`. (Proves the snapshot is not rewritten by later setting changes, D25.) |
| Settings saved | 1 | POST /settings → response contains **"Settings saved"** and the form is pre-filled with the just-saved values. |
| Empty-plan warning | 1 | Restriction yields 0 compatible items → page shows **"No compatible meals found…"** + a link to `/settings`. |
| Budget cap | 1.5 | **Set cap first, then regenerate** a plan whose `totalSalePrice` exceeds it → plan page shows the over-budget banner with the correct two amounts. Clear/raise the cap, regenerate → **no banner**. Snapshot-immutability AT (§7 increment 1.5): setting the cap after an existing plan does **not** retroactively show a banner. |
| Household size | — | *(no observable output — DEFERRED, NEEDS-MODEL)* |
| Kid-friendly | — | *(no observable output — DEFERRED, NEEDS-DATA-SOURCE)* |

---

## 7. Re-sliced plan (sequenced by build cost / data-readiness)

The adversarial review accepted this design **on the condition that dietary is split into its own increment.** Budget is therefore re-sequenced out of increment 1 into increment 1.5 to isolate its schema / snapshot / regenerate-path risk from the dietary slice.

| # | Increment | Data-readiness | Depends on |
|---|-----------|----------------|------------|
| 1 | **Preferences: dietary ONLY** | READY | — |
| 1.5 | **Budget cap (warn effect)** | READY, needs regenerate-path design | increment 1 + regenerate design |
| 2 | **Kid-friendly** | BLOCKED | data-source decision (spike) |
| 3 | **Household size** | BLOCKED | recipe/portion model (SLICE-05) |

**Budget deferred from increment 1 to increment 1.5** to isolate its schema (`budget_cap_cents` on two tables), snapshot (`meal_plans` per-plan cap), and regenerate-path (`POST /plan/regenerate`) risk. Dietary ships alone first because it is the cheapest fully-observable effect and it has no such open design questions (§2.2 explains the architectural asymmetry: dietary re-filters the dashboard live; budget's only observable is the snapshotted plan banner, which needs regenerate to be honestly exercisable).

### Increment 1 — "Preferences: dietary ONLY"

- **Scope**: `user_settings` table with the **dietary column only** (no `budget_cap_cents`); the **new `meal_plans.dietary_filter` snapshot column** (CREATE + ALTER-guard, BLOCKER #2, §1); full `src/preferences/` context (port `ports/preferences-repository.ts`, adapter `adapters/sqlite-user-preferences-repository.ts`, `preferences-service.ts`, `http/settings-handler.ts`); extend `MealPlan` with `dietaryFilter`; `generatePlan(weekStart, items, dietaryFilter)` snapshots the restriction; `getOrGenerateCurrentWeekPlan()` reads the restriction and passes it in; un-hardcode `"none"` at plan-service.ts:118 and discount-handler.ts:50; `GET`/`POST /settings` route in server.ts with a general "Preferences" page (dietary dropdown pre-selected to current value) and a "Settings saved" confirmation; empty-plan warning ("No compatible meals found…") + link to `/settings`.
- **Why first**: dietary is the cheapest fully-live value (wiring on top of already-built `isCompatible()` + filtering query, plus one snapshot column) **and** it validates the original learning hypothesis — *do Munich flyers carry enough vegetarian discounts to fill a plan?* No open design questions.
- **Observable acceptance behavior**: the four increment-1 rows in §6 (dietary filter on plan + dashboard; dietary snapshot immutability; "Settings saved"; empty-plan warning + link).
- **Dependencies**: none. SLICE-02 (3-store pool) already delivered.

### Increment 1.5 — "Budget cap (warn effect)" — prerequisites captured, NOT designed here

*Recorded for the later increment; the full design is deferred (§2.2 holds the analysis seed). Prerequisites the review flagged:*

- **Schema**: add `budget_cap_cents INTEGER` (nullable) to **both** `user_settings` and `meal_plans`, each via the idempotent ALTER-guard idiom (db.ts:87-92 pattern).
- **Regenerate path — `POST /plan/regenerate` decision**: budget's only observable is the snapshotted plan banner; because `getOrGenerateCurrentWeekPlan` is idempotent, changing the cap after a plan exists is invisible without a regenerate action. The endpoint's semantics (does it overwrite the current week's plan? confirm before discarding?) must be designed as part of 1.5.
- **Snapshot-immutability AT**: an acceptance test that asserts the banner does **NOT** retroactively appear on an existing plan when the cap changes — it appears **only** after regenerate. (Mirror of the dietary snapshot-immutability AT in §6.)
- **Settings-page control**: add the "Weekly budget cap" number input (blank = no cap), pre-filled from the repo.
- **`UserPreferences` / `MealPlan` extension**: add `budgetCapCents: number | null`.

### Increment 2 — "Kid-friendly" — BLOCKED (data-source spike)

- **Scope**: a time-boxed spike, **not a shipped setting**. Evaluate the three candidate sources (category heuristic / manual tag / classifier) against a sample of real scraped items; decide whether any produces trustworthy kid-friendly tags. Output: a go/no-go decision + a data-source ADR. Only if go → a follow-on increment adds the tag pipeline, the `kid_friendly` column, and the settings control.
- **Observable acceptance behavior**: none shippable yet — the spike's output is a decision, not a user-facing effect. (This is why it is a spike, not a slice.)
- **Honesty verdict**: **NEEDS-DATA-SOURCE — DEFERRED.** No inert control until a source is validated.
- **Dependencies**: the kid-friendly data-source decision (Open Question 1).

### Increment 3 — "Household size" — BLOCKED (recipe/portion model)

- **Scope**: after a quantity/portion model exists (arrives with recipes, SLICE-05), add `household_size` column (ALTER-guard idiom) and a scaling effect — e.g., plan shows required quantity per meal scaled by household size, or a "serves N" indicator.
- **Observable acceptance behavior**: change household size 2→4 → the plan's displayed quantities (or servings-covered figure) change proportionally.
- **Honesty verdict**: **NEEDS-MODEL — DEFERRED.** No inert control until a portion model makes it observable.
- **Dependencies**: recipe/portion model (SLICE-05); Open Question 2.

---

## 8. Open questions / blockers

1. **Kid-friendly data source — BLOCKER (called out explicitly).** There is no kid-friendliness signal in scraped items (`store, name, category, prices, validUntil, dietary_tags` only). Before kid-friendly can ship as anything but theater, the user must decide the source:
   - (a) **category heuristic** — cheapest, likely inaccurate (kid-friendly is a taste judgment, not a category);
   - (b) **manual tagging by Dimitar** — honest and observable, but needs a tagging UI + storage;
   - (c) **AI/keyword classifier at scrape time** — plausible, but "will a kid eat this" has no ground-truth list; needs a validation spike.
   - **Recommendation**: run the increment-2 spike (option c against a real sample, with option b as fallback) before committing. Do **not** ship a kid-friendly control until a source is validated.

2. **Household size — does it warrant a portion model now, or defer to recipes (SLICE-05)?** Household size is inert without a quantity model. Building a portion model *just* for household size duplicates work that recipes will need anyway. **Recommendation**: defer household size until the recipe/quantity model lands, then ship it on top. Confirm the user accepts household-size being deferred rather than shipped as a stored-but-inert field.

3. **Budget effect scope.** Increment 1.5 ships **warn**, not trim/reject. Trim/reject changes the selection algorithm and is deferred beyond 1.5. Confirm warn is acceptable for v1 (recommendation: yes — cheapest honest effect; revisit only if dogfooding shows warn is ignored).

4. **Dietary value shape reconciliation (brief vs code) — INFO #6 back-propagation note.** The brief's UserPreferences aggregate (brief.md line 334, line 345) models `dietary_restrictions[]` as an **array**, but `src/shared/types.ts`, the original slice ("single-select v1"), and the existing `plan-service`/`discount-service` signatures all use a **single** `DietaryRestriction` enum. **v1 ships a single `dietaryRestriction` enum**; the array shape is a **future extension for allergen combos** and is out of scope for these increments. This is a **DESIGN clarification / back-propagation note only — not a code change**: the brief's aggregate description should be reconciled to single-value for v1, but no code moves because the code is already single-value.
