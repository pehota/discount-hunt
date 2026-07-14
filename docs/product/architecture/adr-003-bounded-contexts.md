# ADR-003: Bounded Context Design for discount-hunt

**Status**: Accepted
**Date**: 2026-07-13
**Wave**: DESIGN — Domain Modeling
**Deciders**: Dimitar Apostolov (owner), Hera (DDD architect)
**Supersedes**: DISCUSS wave informal 4-context identification

---

## Context

The DISCUSS wave identified 4 informal bounded contexts: Scraper, Discount/Pricing, Recipe Matching, and Savings Tracking. Before tactical modeling begins, the domain boundaries must be made precise: each context needs a clear owner aggregate, an explicit integration pattern with its neighbors, and a subdomain classification. Three issues in the DISCUSS output required resolution before architecture could proceed:

1. `discount_items` ownership was claimed by both the Scraper context and the Discount/Pricing context — a split not resolved in DISCUSS.
2. The plan generation and dietary filtering responsibility had no named context owner; it was implied to live inside Discount/Pricing despite being the core domain logic.
3. The `estimated_savings` / `savings_log.saved_amount` consistency requirement was documented as an integration risk but no design decision addressed how equality would be guaranteed.

---

## Decision

### Six bounded contexts, not four

| Context | Subdomain Class | Rationale |
|---------|----------------|-----------|
| Catalogue Scraping | Supporting | External-facing ACL. Translates store-specific catalogue JSON into domain objects. Owns `ScrapeJob` aggregate and all scrape lifecycle metadata. |
| Discount / Pricing | Supporting | Domain owner of `DiscountItem` aggregate. Enforces price invariants. Receives normalized rows from Scraping; supplies discounted item data to Meal Planning. |
| Meal Planning | **Core** | Primary JTBD owner. Generates dietary-filtered, discount-driven 7-day meal plans. Coordinates DiscountItem + Recipe + UserPreferences inputs. Computes and commits `estimated_savings`. Owns `MealPlan` aggregate. |
| Recipe Matching | Supporting | External-facing ACL for Brave Search API and chefkoch.de. Owns `Recipe` aggregate with 7-day cache. Supplies recipe data to Meal Planning. |
| Savings Tracking | Supporting | Weekly savings log. Owns `SavingsRecord` aggregate. Finalized (prior-week) records are immutable; current week's record is replaceable when the plan is regenerated. Downstream of Meal Planning. |
| User Preferences | Generic | Single-row configuration table. Owns `UserPreferences` aggregate. No domain logic — pure read/write of a dietary restriction setting. |

### Resolution of `discount_items` ownership

**Catalogue Scraping** is the Anti-Corruption Layer that normalizes raw external JSON to domain rows and writes them to `discount_items`. **Discount/Pricing** owns the `DiscountItem` aggregate — it defines the invariants (both prices present, `regular_price > sale_price`, `regular_price` immutable) and is the authoritative source for plan generation queries. The Scraping context has write access only at insert time; it does not own the domain model of a discount item.

This follows the standard ACL pattern: the external system (store catalogue) has its own model; the ACL translates at the boundary; the downstream context owns the internal model.

### Meal Planning as explicit core context

The JTBD one-liner ("generate a discount-first 7-day meal plan filtered to dietary restrictions") is the problem this app exists to solve. The coordination logic — reading discounted items, applying dietary filter before item selection, matching recipes, computing savings — is the domain's core competency. It does not belong inside Discount/Pricing (which is concerned only with price data correctness) or as a diffuse application service. A named `Meal Planning` context with a `MealPlan` aggregate root makes this explicit and protects the core domain logic from bleed-through from supporting contexts.

### estimated_savings consistency by construction

The `MealPlan.estimated_savings` and `savings_log.saved_amount` fields must be equal for the same week (shared-artifacts-registry: MEDIUM risk). The design resolves this by writing both values in the **same SQLite transaction** during the `GeneratePlan` command handler. There is no eventual consistency gap — if either write fails, the transaction rolls back and neither value is persisted. This eliminates the need for reconciliation logic, integrity checks, or event-driven synchronization.

### SavingsRecord immutability scope

`SavingsRecord` immutability is scoped to **finalized weeks** (any `week_start` before the current week's Monday). The current week's record is **replaceable** via `ReplaceSavings`, which is called in the same transaction as `RegeneratePlan`. This resolves the apparent contradiction between "permanent log" and "user can regenerate this week's plan":

- US-02 scenario: regenerating the current week's plan replaces both the `meal_plans` row and the current week's `savings_log` row atomically.
- US-04 / US-05: past weeks' savings are never touched by any command, including dietary restriction changes.

The `ReplaceSavings` command enforces a guard: the target `week_start` must equal the current week's Monday, or the command is rejected. This makes prior-week immutability a runtime invariant, not just a convention.

### dietary_filter consumers — all read from one owner

The shared-artifacts-registry flags `dietary_filter` as HIGH risk because all three consumers (Meal Planning, Discount Dashboard, Recipe View) must apply the restriction identically. The User Preferences context is the single supplier. Both Meal Planning and Discount/Pricing consume from it via the same read path — no consumer may derive or cache its own copy of the restriction. This is enforced by module boundary: neither Meal Planning nor Discount/Pricing contains dietary restriction logic; they call into User Preferences to read it.

---

## Consequences

### Positive

- **Explicit ownership**: Every shared artifact from the registry has exactly one aggregate that owns it. No ambiguity about which module validates `regular_price` or applies `dietary_filter`.
- **Core domain visible**: Meal Planning as a named context makes the primary business value traceable in code structure. Solution architects and crafters know where the important logic lives.
- **Consistency by construction**: Same-transaction savings write removes the medium-risk integration checkpoint from the registry; it becomes a structural guarantee, not a runtime assertion.
- **Dietary filter immutability**: `meal_plans.dietary_filter` snapshots the restriction at generation time, making past plan records stable across settings changes. This satisfies US-04 scenario 4 and US-05 scenario 2 without special handling.
- **ACL pattern on both external boundaries**: Stores (catalogue JSON) and recipe sources (Brave + Chefkoch JSON-LD) both have substrate probes already designed (see System Architecture section). The ACL pattern formalizes where those probes live (Catalogue Scraping and Recipe Matching respectively) and prevents external schema changes from propagating into the domain model.

### Negative / Trade-offs

- **Six modules instead of four**: Slightly more initial scaffolding. Accepted because the boundary clarity reduces cognitive load during long-term maintenance more than it costs in setup.
- **User Preferences as a separate context** introduces one more module for a single-row table. Justified by the high integration risk of `dietary_filter` (shared-artifacts-registry: HIGH) — having a named owner prevents the restriction from being read from multiple places independently.

### Neutral

- Boundaries are logical (module directories + import discipline), not deployment boundaries. Per D11 (modular monolith) and D26, the "independently deployable" DDD criterion is intentionally waived. All contexts share one SQLite file and one process.
- Event Sourcing and CQRS are not warranted. See ADR narrative below and ES/CQRS Assessment in `brief.md`.

---

## Alternatives Considered

### Keep four contexts (DISCUSS proposal)

Rejected because:
- `discount_items` ownership collision remained unresolved — two contexts with write access to the same table is a design defect, not a boundary.
- Plan generation logic had no named home, risking it becoming a fat application service with no aggregate to enforce invariants.
- `dietary_filter` had no clear owner; all three consumers risked reading it independently with divergent logic.

### Merge Savings Tracking into Meal Planning

Technically viable — `savings_log` is always written in the same transaction as `meal_plans`. Rejected because the savings history display (US-04) is a distinct user concern with its own read patterns (week history, month total, staleness display). Keeping Savings Tracking as a named context makes the append-only immutability constraint explicit and gives the `SavingsRecord` aggregate a clear identity. A merged context would either blur the immutability invariant or require Meal Planning to carry savings-display query logic that doesn't belong to plan generation.

### Merge User Preferences into Meal Planning

Rejected because `dietary_filter` is read by the Discount Dashboard (Discount/Pricing context) as well as by Meal Planning. A shared supplier with a named context (User Preferences) is cleaner than embedding settings access inside the core context and requiring other contexts to call into it.

---

## Ubiquitous Language (per context)

### Catalogue Scraping

| Term | Definition |
|------|-----------|
| `ScrapeJob` | One execution of the scraper for a given store. Has lifecycle: running → completed/failed. |
| `last_successful_run` | Timestamp of the most recent scrape that completed with valid data. Used for staleness calculation. |
| `item_count` | Number of catalogue items that qualified (had both `price` and `discountedPrice` fields). |

### Discount / Pricing

| Term | Definition |
|------|-----------|
| `DiscountItem` | A catalogue item that has a promotional price this week. Only items with both a `regular_price` and `sale_price` qualify. |
| `regular_price` | The non-promotional unit price of the item, captured at scrape time. Immutable. Used as savings baseline. |
| `sale_price` | The current promotional price. Always less than `regular_price`. |
| `valid_until` | The last day the promotional price is valid. After this date, the item is expired. |

### Meal Planning

| Term | Definition |
|------|-----------|
| `MealPlan` | A 7-day schedule of meals generated for a specific `week_start`. Contains lunch and dinner for each of 7 days. |
| `meal` | A value object within a `MealPlan`: one slot (lunch or dinner) for one day, optionally linked to a `DiscountItem` and a `Recipe` by ID. |
| `dietary_filter` | The restriction snapshot captured at plan-generation time. Determines which `DiscountItem`s and `Recipe`s were eligible. Immutable after plan creation. |
| `estimated_savings` | The sum of `(regular_price - sale_price)` for all meals in the plan that reference a discounted item. Computed once at plan-generation time. |
| `discount-driven meal` | A meal whose primary ingredient is a `DiscountItem` from the current week. Distinguished from budget-friendly filler meals in the UI. |

### Recipe Matching

| Term | Definition |
|------|-----------|
| `Recipe` | A structured representation of a recipe: title, ingredient list, preparation steps, source URL, and cached content. Keyed by `ingredient_name`. |
| `cached_at` | When the recipe content was fetched. TTL is 7 days. |
| `source_url_valid` | Whether the original source URL was reachable on last check. False → show cached content with "unavailable" notice. |
| `ingredient_name` | The canonical lookup key for recipe search. Matches the `name` field of the `DiscountItem` being cooked. |

### Savings Tracking

| Term | Definition |
|------|-----------|
| `SavingsRecord` | An immutable record of a week's savings. Written once when a plan is generated. Never updated. |
| `saved_amount` | `total_regular_price - total_sale_price` for the items in the week's plan. Equals `MealPlan.estimated_savings`. |
| `week_start` | The Monday date of the week this record covers. Used as the display and grouping key. |

### User Preferences

| Term | Definition |
|------|-----------|
| `dietary_restrictions` | An array of restriction tags (e.g., `["vegetarian"]`). Applied as an exclusion filter at meal plan generation. |

---

## References

- `docs/product/architecture/brief.md` — Domain Model section (aggregates, context map, ES/CQRS assessment, D19–D28)
- `docs/feature/discount-hunt/feature-delta.md` — DISCUSS wave decisions D1–D10, user stories US-01 through US-06
- `docs/feature/discount-hunt/discuss/shared-artifacts-registry.md` — 7 shared artifacts with integration risks
