# SPIKE-02 Findings: Recipe Lookup via Brave Search + schema.org/Recipe JSON-LD

**Date**: 2026-07-13
**Probe question**: Can we query the Brave Search API with a German ingredient name and extract a usable recipe (name, ingredients, steps, source URL) from the top result's schema.org/Recipe JSON-LD?

---

## Binary Verdict

**EXTRACTION WORKS. SEARCH UNVALIDATED (no Brave key available).**

The riskier half — JSON-LD Recipe extraction from Chefkoch — is fully validated: 3/3 extractions succeeded with name, ingredients, steps, and source URL. The search half (Brave API returning Chefkoch URLs for German queries) was mocked and remains an open risk.

---

## What Was Proven vs. What Was Assumed

### Proven by probe

| Finding | Evidence |
|---------|----------|
| Chefkoch serves `schema.org/Recipe` JSON-LD in `<script type="application/ld+json">` | 3/3 pages returned valid Recipe JSON-LD |
| `@type: "Recipe"` directly — no `@graph` nesting | Confirmed on 3 pages |
| `recipeIngredient[]` present: 8–15 items, German free-text strings | Confirmed |
| `recipeInstructions[]` uses `HowToSection > HowToStep[]` nesting | Confirmed |
| `url` field ABSENT on Chefkoch — must use `mainEntityOfPage` as fallback | Confirmed |
| Chefkoch reachable via plain HTTP with Chrome UA — no bot protection | 200 OK, no CAPTCHA |
| BBC Good Food Recipe data is in `__NEXT_DATA__` (non-standard), not standard JSON-LD | Confirmed |
| AllRecipes blocked by Cloudflare — plain HTTP returns challenge page | Confirmed |

### Unvalidated (requires live Brave API key)

| Claim | Status |
|-------|--------|
| German queries return Chefkoch as #1 result | NOT TESTED |
| `search_lang=de&country=de` reliably surfaces German-language recipes | NOT TESTED |
| Dietary suffix ("vegetarisch") influences ranking toward vegetarian results | NOT TESTED |

---

## Extraction Quality (Chefkoch — validated)

| Recipe tested | Ingredients | Steps | URL recovered |
|---------------|-------------|-------|---------------|
| Vegetarische Rote Linsen-Bolognese | 15 | 4 | via `mainEntityOfPage` |
| Zucchinicremesuppe | 8 | 2 | via `mainEntityOfPage` |
| Indische Linsensuppe | 14 | 3 | via `mainEntityOfPage` |

---

## Site Coverage

| Site | JSON-LD Recipe | Language | Bot protection |
|------|----------------|----------|----------------|
| Chefkoch | YES — standard `<script type="application/ld+json">` | German | None |
| BBC Good Food | YES — but buried in `__NEXT_DATA__` | English | None |
| AllRecipes | UNKNOWN — Cloudflare blocks | English | Cloudflare |

**Recommendation**: Chefkoch is the primary and sufficient recipe source for German vegetarian recipes.

---

## Brave API Key

Not available in probe environment. To obtain:
1. Register at https://api.search.brave.com/app/login (free tier, no credit card)
2. Free tier: 2,000 queries/month
3. Set as `BRAVE_API_KEY` env var

**Monthly budget**: ~260 queries/year at 5 meals/week — comfortably within free tier.

**Fallback**: Chefkoch's own site search (`https://www.chefkoch.de/suche.php?suche=<query>`) is reachable without a Brave key. Eliminates external search dependency.

---

## Working Extraction Pattern

```typescript
// 1. Extract all JSON-LD blocks
const regex = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;

// 2. Find @type: "Recipe" (may be string or string[])

// 3. URL fallback: Chefkoch omits `url` — use `mainEntityOfPage`
const sourceUrl = recipe.url ?? recipe.mainEntityOfPage;

// 4. Steps: HowToSection > itemListElement[] on Chefkoch
```

---

## Design Implications for DESIGN Wave

1. **Chefkoch is primary recipe source** — German, vegetarian-friendly, no bot protection, standard JSON-LD.
2. **Two-step lookup per ingredient**: Brave Search → top URL → JSON-LD extraction (or Chefkoch site search as fallback).
3. **`url` field not reliable on Chefkoch** — always fall back to `mainEntityOfPage`.
4. **Ingredient strings are unstructured free text** — store as-is, no NLP needed for display.
5. **Cache by ingredient name, 7-day TTL** — ~5 lookups per weekly plan generation.
6. **Brave search relevance is the remaining open risk** — validate with a live key before DESIGN commits to Brave. Low effort: register free key, run 5 queries.

---

## Probe code

`/tmp/spike_discount_hunt_02/probe.ts` — Bun TypeScript, ~200 lines.
Run: `bun run /tmp/spike_discount_hunt_02/probe.ts`
