# discount-hunt

Scrapes weekly supermarket discount catalogues, builds a 7-day meal plan from the
cheapest compatible items, links each meal to a real recipe, and tracks how much you
save. Built for a single household in Munich (Aldi Süd + V-Markt).

## What it does

- **Discount feed** — weekly discounts across stores, filtered live by your dietary preference.
- **Meal plan** — a 7-day plan (14 slots: lunch + dinner) generated from the discounted items.
- **Preferences** — dietary restriction (none / vegetarian / vegan) and a weekly budget cap.
- **Recipes** — each meal links to a Chefkoch recipe (ingredients, steps, source link),
  highlighting which ingredients are on sale this week.
- **Savings** — this-week breakdown, weekly history, and a month-to-date total.

## Stack

- **Runtime / tests:** [Bun](https://bun.sh)
- **Language:** TypeScript, OOP (classes for services & adapters), hexagonal ports/adapters
- **Storage:** SQLite via Drizzle ORM (single file, WAL mode)
- **Server:** Bun HTTP, server-rendered HTML (no build step)
- **AI:** Anthropic Haiku for V-Markt PDF catalogue extraction
- **Recipes:** Chefkoch site-search + schema.org/Recipe JSON-LD (no API key)

Architecture reference: `docs/product/architecture/brief.md`.

## Prerequisites

- [Bun](https://bun.sh) (`curl -fsSL https://bun.sh/install | bash`)
- `ANTHROPIC_API_KEY` — only for live scraping (V-Markt extraction)

## Getting started

```bash
bun install

# Populate the database with real catalogues (needs ANTHROPIC_API_KEY for V-Markt)
ANTHROPIC_API_KEY=sk-... bun run scrape

# Start the server (defaults to http://localhost:3000)
bun run start
```

Open http://localhost:3000, set your preferences at `/settings`, then generate a plan.

> No sample fixtures ship in the repo. For offline/dev runs, point `FAKE_CATALOGUE_FIXTURE`
> at your own Aldi Süd catalogue JSON and set `CATALOGUE_SOURCE=fake` (see Scraping below).

## HTTP routes

| Method | Path                  | Description                                        |
|--------|-----------------------|----------------------------------------------------|
| GET    | `/`                   | Discount feed (filtered by current dietary pref)   |
| GET    | `/settings`           | Preferences page (dietary + budget)                |
| POST   | `/settings`           | Save preferences                                   |
| POST   | `/plan/generate`      | Generate the current week's plan                   |
| GET    | `/plan`               | View the current week's meal plan                  |
| GET    | `/plan/{day}-{slot}`  | Recipe detail for a meal (e.g. `/plan/1-lunch`)    |
| GET    | `/savings`            | Savings history + month-to-date                    |

## Scraping

Run weekly (e.g. via cron / systemd timer):

```bash
# Live (requires ANTHROPIC_API_KEY for V-Markt)
ANTHROPIC_API_KEY=sk-... CATALOGUE_SOURCE=live bun run scrape

# Fake (deterministic, offline — supply your own catalogue JSON fixture)
FAKE_CATALOGUE_FIXTURE=/path/to/aldi-catalogue.json CATALOGUE_SOURCE=fake bun run scrape
```

## Configuration

| Env var                  | Default                 | Purpose                                             |
|--------------------------|-------------------------|-----------------------------------------------------|
| `PORT`                   | `3000`                  | HTTP server port                                    |
| `TEST_DB_PATH`           | `./discount-hunt.db`    | SQLite file path (server + scraper)                 |
| `CATALOGUE_SOURCE`       | `live`                  | `live` or `fake`                                    |
| `FAKE_CATALOGUE_FIXTURE` | —                       | Aldi Süd JSON fixture path (required when `fake`)   |
| `FAKE_VMARKT_FIXTURE`    | —                       | V-Markt fixture path (optional, `fake` mode)        |
| `ANTHROPIC_API_KEY`      | —                       | Required when `CATALOGUE_SOURCE=live`               |

## Testing

```bash
bun test                 # full suite (unit + acceptance)
bun run test:acceptance  # acceptance tests only
```

Acceptance tests boot the real HTTP server on an OS-assigned ephemeral port and never
hit the network (a fake recipe source is injected). The live Chefkoch adapter is
validated by spike probes, not the suite.

## Git hooks

Version-controlled hooks live in `.githooks/` and are auto-wired by `bun install`
(via the `prepare` script), or manually with `bun run hooks:install`. The `pre-push`
hook runs `bun run hook:push` before every push (see that script in `package.json` for
the exact checks); `pre-commit` checks that your git `user.name` / `user.email` are set.

## Project layout

```
src/
  scraping/        catalogue fetch + normalize + scrape jobs (Aldi Süd, V-Markt/Haiku)
  discount/        discount feed (GET /) + repository
  meal-planning/   plan generation, plan view, budget snapshot
  preferences/     user_settings (dietary + budget) + /settings
  savings/         savings log + history/month-to-date
  recipe/          RecipeSource port, Chefkoch adapter, recipe detail view
  shared/          db, schema, types, layout (HTML shell), html escaping, week helpers
tests/acceptance/  end-to-end HTTP acceptance tests
docs/              architecture SSOT, feature specs, evolution log
```

## Conventions

- Colocated tests (`*.test.ts` next to the code).
- Conventional commits.
- Development paradigm: OOP. Mutation testing: nightly-delta (CI).
