# SLICE-01: Walking Skeleton — Aldi Süd, 1 meal, 1 saving

## Goal
Prove the end-to-end pipeline works: scrape one real discounted item from Aldi Süd, store it with regular price, generate a one-meal plan, display it in the browser, and show a concrete savings amount (e.g., €0.80 saved on Bio Haferflocken).

## IN Scope
- Scraper: Aldi Süd only, fetches current week's promotional items
- Storage: discount_items table with `item_name`, `sale_price`, `regular_price`, `store`, `valid_until`, `scrape_timestamp`
- Discount dashboard: lists 1+ items from Aldi Süd with both prices
- Meal plan generation: 1-meal plan (any meal) using the cheapest discounted item
- Recipe link: hardcoded stub URL (e.g., "https://example.com/red-lentil-soup") attached to the meal — covers the Match Recipes backbone activity; real recipe engine in SLICE-05
- Savings: savings tab shows a concrete savings amount (e.g., "Saved €0.80 on Bio Haferflocken") for that 1 item
- Web UI: minimal (functional, not polished)

## OUT Scope
- Edeka and V-Markt scrapers (SLICE-02)
- 7-day meal plan (SLICE-02)
- Dietary restriction filter (SLICE-03)
- Settings page (SLICE-03)
- Savings history (SLICE-04)
- Recipe matching engine, API integration, ingredient highlighting (SLICE-05)

## Learning Hypothesis
**Confirms**: The scrape → store → plan → display pipeline can complete end-to-end in a single session.
**Disproves if it fails**: The assumption that Aldi Süd's website is scrapable with basic HTTP requests (no JS renderer required). If the scraper cannot retrieve any data, this signals the SPIKE finding has already been invalidated and DESIGN must reconsider the entire acquisition layer.

## Acceptance Criteria
- At least 1 discounted item from Aldi Süd is visible in the browser dashboard with both sale price and regular price
- Clicking "Generate Meal Plan" produces a plan containing at least 1 meal using that item
- Savings tab shows a savings amount (e.g., "Saved €0.80 on Bio Haferflocken") computed from regular_price - sale_price for that item
- The pipeline completes without manual intervention after initial setup

## Dependencies
- Post-DISCUSS SPIKE (scraping feasibility) should have validated Aldi Süd before this slice ships; if SPIKE is in progress, SLICE-01 is the concrete validation vehicle

## Effort Estimate
≤1 day (6 hours crafter dispatch)
Reference class: "minimal scraper + 3-table DB + 4-page web app with no auth"

## Dogfood Moment
Dimitar runs the scraper at 18:00, opens `http://localhost/`, sees a real Aldi Süd item with a real price (e.g., Bio Haferflocken €1.49 was €2.29), clicks Generate, and sees "Saved €0.80" on the Savings tab. Within the same evening.

## Pre-slice SPIKE
SPIKE-01: Validate that Aldi Süd promotional page is accessible via HTTP GET without JS rendering and without triggering rate limiting. Output: `docs/feature/discount-hunt/spike-01-scraping-feasibility.md`.
