# SPIKE-03 Findings: Edeka + V-Markt Plain HTTP Scraping

**Date**: 2026-07-14
**Probe question**: Can we fetch Edeka and V-Markt Munich discount items via plain HTTP?

promoted on 2026-07-14

---

## Binary Verdict

**PARTIALLY WORKS**: V-Markt Munich plain HTTP works (Apache/Pimcore, no bot protection). Edeka fully blocked by Akamai Bot Manager on all paths of `www.edeka.de`; no unprotected catalogue subdomain exists.

---

## Edeka

### Access Method

**Playwright required** (or alternative source — see Edge Cases).

### Approach (if accessible)

Plain HTTP is not viable. `www.edeka.de` is CNAME'd to Akamai EdgeKey (`www-v2.edeka.de.edgekey.net`) and returns `HTTP 403` with `server: AkamaiGHost` for every path including `/`, `/angebote/`, `/angebote-der-woche/`, `/wochenangebote/`, `/prospekt/`, `/deals/`, and all API paths tried. No JS bundle inspection or alternate User-Agent bypasses this.

DNS audit confirmed:
- `prospekt.edeka.de` NXDOMAIN
- `angebote.edeka.de` NXDOMAIN
- `katalog.edeka.de` NXDOMAIN
- `api.edeka.de` NXDOMAIN

No Publitas catalogue found for any Edeka cooperative slug (edeka, edeka-ag, edeka-sudbayern, edeka-minden-hannover, edeka-rhein-ruhr — all 404 on view.publitas.com).

Third-party aggregators (MeinProspekt / Kaufda / Bonial) are SPAs or return empty HTML for API paths; no exploitable structured JSON feed found.

Next.js static asset chunks (`/_next/static/chunks/*.js`) do load without Akamai block (HTTP 200), but are minified and reveal no actionable API endpoint patterns in a quick probe.

### Sample Data

None obtained via plain HTTP.

### Data Shape

Unknown (blocked).

### Edge Cases

1. **Edeka is a federation** — Munich belongs to Edeka Sudbayern cooperative. There is no `edeka-sudbayern.de` domain (NXDOMAIN). The national `www.edeka.de` is the only digital point of entry and it is fully Akamai-gated.

2. **Static JS assets bypass Akamai** — `/_next/static/chunks/*.js` return HTTP 200. A deeper investigation of the React Server Component fetch calls in the compiled app bundle could reveal internal API endpoints. Not attempted in this probe due to time budget.

3. **Playwright path exists** — SPIKE-01 already proved Playwright bypasses Akamai. An `api.edeka.de` analogue may exist within an authenticated Playwright session. Not pursued here.

4. **Potential alternative: `meinprospekt.de` scraping** — Bonial aggregates Edeka offers in their own SPA. Would introduce a third-party aggregator dependency. Not tested in depth.

---

## V-Markt

### Access Method

**Plain HTTP — works.** Server: Apache. No bot protection. No authentication. No CAPTCHA.

### Approach (if accessible)

Two-step approach, both steps plain HTTP:

**Step 1 — Slug discovery** (SSR HTML scrape):

```
GET https://www.v-markt.de/angebote/muenchen
→ HTTP 200 (Pimcore SSR, no bot protection)
→ Parse all pageflip.v-markt.de/muenchen/<slug> hrefs
→ Filter for VMMUC slugs, exclude BMMUC (Baumarkt) and _fischwerbung (fish special)
→ Sort descending by date prefix → take latest slug
```

Slug format: `DDMM_VMMUC` where DDMM is day+month of the Thursday start date.
Example: week Thu 16.07–Wed 22.07 → `1607_VMMUC`.

**Step 2 — Catalogue fetch** (direct HTML):

```
GET https://www.pageflip.v-markt.de/muenchen/1607_VMMUC/
→ HTTP 200, HTML (~44KB), server: Apache
→ Product data in <p> tags as flat text
→ Discount pattern: "REGULAR - PERCENT% SALE" (e.g. "19.45 - 17 % 15.99")
→ Validity dates: "Gültig von Do. DD.MM. bis Mi. DD.MM.YYYY"
```

Pageflip is V-Markt's own self-hosted digital catalogue platform (not Publitas). No structured JSON API found.

### Sample Data

Week: Thu 16.07.2026 – Wed 22.07.2026. Catalogue slug: `1607_VMMUC`.

| Item | Regular Price | Sale Price | Discount |
|------|--------------|------------|----------|
| Oro di Parma Tomaten/Tomatenmark (200g-Tube/400g-Dose) | 1.99 EUR | 1.11 EUR | -44% |
| Pampers baby-dry Windeln oder Pants (38-84 Stuck Big Pack) | 19.45 EUR | 15.99 EUR | -17% |
| Adelholzener Mineralwasser (12 x 1-Liter-Kiste) | 13.49 EUR | 9.49 EUR | -29% |
| Dallmayr Prodomo Kaffee (500g-Packung) | 10.49 EUR | 6.49 EUR | -38% |
| Herta Finesse Aufschnitt (100g-Packung) | 4.99 EUR | 3.99 EUR | -20% |

Items with only a current offer price (no explicit "was" price):
- Cherrytomaten von der Gemuseinsel Reichenau 300g: 2.29 EUR
- Bio Kiwi grun Zespri je Stuck: 0.49 EUR
- Nektarinen oder Pfirsiche 1 kg: 1.49 EUR

Total regex pattern matches in probe run: **133** across 25 paragraphs. Of these, **122 are valid** price triplets (sale < regular, discount % consistent within ±5% tolerance). **11 are garbled** — price ordering is inconsistent across catalogue sections: inline sections use `regular - pct% sale` (e.g. `19.45 - 17 % 15.99`), columnar sections may use a different layout where the regex captures cross-product values. The 11 garbled triplets have sale ≥ regular or a discount % that doesn't match the ratio.

### Data Shape

All product data lives in `<p>` tag text nodes. No structured JSON. No semantic HTML attributes for prices.

Raw paragraph excerpt:
```
Oro di Parma Tomaten oder Tomatenmark verschiedene Sorten
je 200-g-Tube / 400-g-Dose / Tetrapack 1 kg = 2.78 - 5.55
1.99 - 44 % 1.11
Pampers baby-dry Windeln oder Pants 38 - 84 Stuck verschiedene Grossen
je Big Pack 19.45 - 17 % 15.99
```

Discount price pattern (regex): `(\d+\.\d{2})\s+-\s+(\d+)\s?%\s+(\d+\.\d{2})`

Offer-only price (no "was"): standalone `\d+\.\d{2}` not followed by `- \d+\s?%`

Validity date pattern: `Gultig von [A-Za-z.]+\s+DD.MM. bis [A-Za-z.]+\s+DD.MM.YYYY`

### Edge Cases

1. **Name-price association is unreliable** — The PDF-to-HTML conversion renders names and prices as flat text. In sections like "Tiefkuhlprodukte", all product names appear first followed by all prices as a separate block. Reliable automatic name-to-price matching is not possible without additional heuristics.

2. **Two offer types**: (a) Explicit regular+sale price pair (133 found, computable savings). (b) Offer-only price with no "was" reference (savings not computable). Both appear in the same paragraph.

3. **Multiple catalogue types per week**: Main weekly (`VMMUC`), Baumarkt (`BMMUC`), fish special (`_fischwerbung`). Filter by keeping slugs matching `^\d{4}_VMMUC$` exactly.

4. **Catalogue timing**: V-Markt week runs Thursday to Wednesday. The upcoming catalogue appears on the angebote page before the week starts (scraped Monday 14 July, catalogue valid from Thursday 16 July). Safe to scrape Monday for Thursday-onwards offers.

5. **Munich has 2 V-Markt locations** (Balanstrase 50 Munchen-Ost and Maria-Probst-Strase 6 Munchen Nord). Both share the same regional Munich catalogue.

---

## Comparison Table

| Dimension | Aldi Sud (SPIKE-01 addendum) | Edeka | V-Markt |
|-----------|------------------------------|-------|---------|
| Access method | Plain HTTP (Publitas CDN) | **Playwright required** (Akamai-blocked) | **Plain HTTP** (Apache/Pimcore) |
| Entry point | HEAD prospekt.aldi-sued.de/ 302 slug | None (all paths 403) | GET v-markt.de/angebote/muenchen → parse pageflip slug hrefs |
| Catalogue platform | Publitas (CDN static JSON) | Unknown (Akamai-gated) | Pageflip (self-hosted HTML) |
| Bot protection | None on prospekt.* | Akamai Bot Manager (all paths) | None |
| Data format | Structured JSON (hotspots_data.json) | Unknown | Flat text in HTML p tags |
| Regular price | price field (99% coverage) | Unknown | Inline text prefix to sale price (~50%+ of items) |
| Sale price | discountedPrice field (20% of items) | Unknown | Inline pattern X.XX - Y% Z.ZZ (122 valid + 11 garbled) |
| Valid dates | Infer from KW slug + date arithmetic | Unknown | Embedded: "Gultig von ... bis ..." |
| Slug discovery | Single HTTP HEAD (302 Location) | N/A | HTML scrape of /angebote/muenchen |
| Item count | 155 items (full catalogue) | Unknown | 122 validated discounted + 11 garbled + unknown offer-only items |
| Infrastructure cost | Zero | Chromium ~114MB | Zero |
| Name-price association | Clean (separate JSON fields) | Unknown | **Unreliable** (flat text, layout lost) |

---

## Design Implications for Slice-02

1. **Two scraper strategies required**. V-Markt uses plain HTTP (same approach class as Aldi Sud prospekt). Edeka requires Playwright — already proven viable in SPIKE-01 and already in scope if Aldi Sud's original api.aldi-sued.de path is kept as fallback. Adding Edeka as Playwright-based adds no new infrastructure if Playwright is already in runtime.

2. **V-Markt extraction requires text parsing, not JSON parsing**. Three implementation options:
   - Option A (regex-only): Extract (regular, discount%, sale) triplets, then validate each with `sale < regular` and `|expected_sale - sale| / regular < 5%` to discard garbled rows. Usable count: ~122/week. **Names are unreliable** (flat text, layout lost) AND **~8% of price triplets are garbled** due to inconsistent price ordering between inline and columnar PDF sections. Acceptable only if anonymous savings alerts are the goal (not item names).
   - Option B (LLM-assisted): Send each `<p>` tag to a cheap LLM for structured extraction. Resolves both name-price association and price-ordering ambiguity. Higher cost (~$0.001/catalogue run with Haiku). Recommended if item names matter.
   - Option C (PDF source): V-Markt publishes a PDF of the same catalogue. PDF parsing may give better text layout. Not validated in this spike.

3. **Slug discovery for V-Markt is an HTML scraping step** (unlike Aldi Sud's clean HTTP HEAD). The www.v-markt.de/angebote/muenchen page must be fetched and parsed. This page is Pimcore SSR with no bot protection — reliable plain HTTP.

4. **Edeka blocks the current implementation path**. If Edeka is required for Slice-02, Playwright must be in the runtime. If optional, V-Markt + Aldi Sud give 2 Munich stores via plain HTTP only. This is a DESIGN/DELIVER decision.

5. **V-Markt vegetarian item filtering** is feasible via keyword matching on product names (even imperfect ones) — same approach as Aldi Sud.

---

## Probe Code Location

`/tmp/spike_discount_hunt_03/probe.ts` — Bun-compatible TypeScript (Edeka Akamai check + V-Markt slug discovery + catalogue fetch + item count)

Do not delete until promotion gate decision.

---

## Addendum — Aldi `hotspots_data.json` real schema (discovered 2026-07-15, DELIVER phase 11)

The SPIKE-01 addendum treated the Aldi Süd Publitas feed as a flat list of `type: "product"` hotspots with top-level `price` / `discountedPrice`. The live extraction fix in DELIVER phase 11 revealed the schema is one level deeper and encodes discounts differently:

1. **Products are nested.** Each `type: "product"` hotspot entry nests its actual items under a `products: []` array. The parser must read `entry.products[]`, not the entry itself. (The prior flat read is why only a fraction of items were seen.)
2. **Discount = nested price comparison.** A genuine discount is `nested.discountedPrice < nested.price`. Entries where this does not hold are regular-price items, not discounts, and must be dropped at the ACL boundary (consistent with the both-price invariant).
3. **`validUntil` must be derived — the feed gives no end date.** `customLabel1` is a German `"d.m."` **start** date only (e.g. `"14.7."`) — no year, no end date. The normalizer sets `validUntil` to an ISO end-of-current-week date (the Aldi promotional week), since the feed does not publish a validity range.
4. **Pagination ranges overlap.** Successive catalogue pages return overlapping product ranges; the fetcher must de-overlap (dedupe) across pages or the same discount is registered multiple times.

**Downstream repo-guard finding (phase 11-02):** the normalizer must default a missing `category` to `"unknown"`. A prior undefined `category` binding caused Drizzle to **silently drop** the undefined interpolation → malformed SQL → only a subset of items persisted (8 of 31 in the live run). The SQLite repository now fails loudly on any undefined bind value rather than silently emitting bad SQL.

**Net effect:** the live Aldi scrape now persists all genuine discounts (31/31 in the 2026-07-15 live run), where the pre-fix path persisted only 8.
