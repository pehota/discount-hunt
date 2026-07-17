# Database schema

Entity-relationship diagram of the SQLite schema. **Source of truth: `src/shared/schema.ts`** (Drizzle defs; the runtime DDL generator in `src/shared/schema-ddl.ts` builds the tables from it). Regenerate this diagram from that file if the schema changes.

```mermaid
erDiagram
    %% ── Hard FKs (enforced, PRAGMA foreign_keys=ON) — solid lines ──
    stores        ||--o{ scrape_jobs   : "store_id"
    stores        ||--o{ discount_items: "store_id"
    stores        ||--o{ offer_history : "store_id"

    %% ── Soft refs (documented, NOT FK-enforced) — dashed lines ──
    scrape_jobs    |o..o{ discount_items      : "scrape_job_id (soft)"
    scrape_jobs    |o..o{ offer_history       : "scrape_job_id (soft)"
    discount_items |o..o{ offer_history       : "item_id (soft)"
    discount_items |o..o{ shopping_list_items : "discount_item_id (soft)"
    meal_plans     |o..o{ savings_log         : "plan_id (soft)"

    stores {
        integer id PK
        text    name UK
        text    slug UK
        integer created_at
    }

    scrape_jobs {
        text    id PK
        integer store_id FK
        text    status "running|completed|failed"
        integer started_at
        integer completed_at "nullable"
        integer item_count "default 0"
        text    error_message "nullable"
    }

    discount_items {
        text    id PK "store:externalId"
        integer store_id FK
        text    name
        text    category "raw German productType"
        integer regular_price "cents, write-once"
        integer sale_price "cents"
        text    valid_until "ISO date"
        text    dietary_tags "JSON, default []"
        text    tags "JSON Tag[], default []"
        text    taxonomy_category "nullable = unclassified"
        text    source_url "nullable"
        text    image_url "nullable"
        text    brand "nullable"
        text    description "nullable"
        text    scrape_job_id "soft ref"
        integer created_at
    }

    offer_history {
        integer history_id PK "autoincrement"
        text    item_id "soft ref -> discount_items.id"
        integer store_id FK
        text    name
        text    category
        integer regular_price
        integer sale_price
        text    valid_until
        text    dietary_tags "JSON, default []"
        text    tags "JSON, default []"
        text    taxonomy_category "nullable"
        text    source_url "nullable"
        text    image_url "nullable"
        text    brand "nullable"
        text    description "nullable"
        text    scrape_job_id "soft ref (old row)"
        integer created_at "original first-insert"
        integer archived_at "ms of archive"
        text    week_start "ISO Monday"
    }

    meal_plans {
        text    id PK
        text    week_start "ISO Monday"
        text    item_ids "JSON array"
        text    meals "JSON Meal[], default []"
        text    dietary_filter "snapshot, default none"
        integer budget_cap_cents "nullable"
        integer total_regular_price "cents"
        integer total_sale_price "cents"
        integer estimated_savings "cents"
        integer created_at
    }

    savings_log {
        text    id PK
        text    plan_id "soft ref"
        text    week_start
        integer saved_amount "cents"
        integer total_sale_price
        integer total_regular_price
        integer item_count
        integer recorded_at
    }

    shopping_list_items {
        text    id PK
        text    week_start "ISO Monday"
        text    source "discount|manual"
        text    name
        text    store "nullable (manual rows)"
        integer sale_price_cents "nullable"
        integer regular_price_cents "nullable"
        text    discount_item_id "soft ref, nullable"
        text    taxonomy_category "nullable"
        integer added_at
    }

    user_settings {
        text    user_id PK "singleton, default dimitar"
        text    dietary_restriction "default none"
        integer budget_cap_cents "nullable"
        integer kid_friendly "0/1"
        integer household_size "default 2"
        text    cooking_time "default any"
        text    meal_types "JSON, default"
        integer updated_at
    }

    recipes {
        text    id PK
        text    query_key UK "cache-by-query"
        text    name
        text    cached_content "JSON ingredients+steps"
        text    source_url
        integer source_url_valid "0/1"
        integer cached_at "TTL 7d"
    }
```

## Notes

- **Solid `||--o{`** — enforced FK to `stores(id)` (three: `scrape_jobs`, `discount_items`, `offer_history`; `foreign_keys=ON`).
- **Dashed `|o..o{`** — soft ref by design (no FK): append-only (`scrape_job_id`), price-history join key (`offer_history.item_id`), or snapshot / weekly-regen links (`shopping_list_items.discount_item_id`, `savings_log.plan_id`). Hard FKs would fight delete-reinsert (replace-per-store scrape) and weekly regeneration.
- `offer_history` mirrors `discount_items` + `archived_at` / `week_start`; PK is a surrogate `history_id` because `item_id` repeats across weekly archives. Populated by archive-on-replace inside `SQLiteDiscountItemRepository.replaceStore`.
- `stores` is name-at-boundary: canonical list in `src/shared/stores.ts`, id resolution in `src/shared/store-registry.ts`; domain/HTTP/tests stay name-based.
- `user_settings` (single-user singleton) and `recipes` (query cache, 7-day TTL) are standalone — no relationships.
- Types shown are SQLite affinities (`integer` / `text`); cents are integers, timestamps are ms-since-epoch integers, ISO dates/JSON payloads are text.
