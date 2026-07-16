/**
 * MarktguruEdekaCatalogueFetcher — ACL adapter for the marktguru EDEKA offers API.
 *
 * Protocol:
 *   1. Bootstrap: GET https://www.marktguru.de/ and scrape the "apiKey"/"clientKey"
 *      values embedded in the homepage config JSON. Missing either → throw.
 *   2. For each curated search term SEQUENTIALLY (be polite): GET the offers-search
 *      endpoint with x-apikey / x-clientkey / User-Agent headers. A term whose
 *      request rejects OR returns a non-ok response is logged and SKIPPED — it does
 *      NOT abort the whole run.
 *   3. Keep only offers advertised by edeka itself. edeka-center (hypermarket)
 *      and edeka-xpress (convenience) are different STORE FORMATS that list the
 *      same products under distinct offer ids, so they are excluded to avoid
 *      triplicates.
 *   4. Dedupe by offer.id (an offer surfaces across many terms).
 *   5. Secondary dedupe by (product.id, price): the same product listed under
 *      several store formats has distinct offer ids but a shared product.id, so
 *      the offer.id dedupe alone does not collapse it. Falls back to product.name
 *      when product.id is absent.
 *   6. Map each survivor to the CatalogueNormalizer-compatible shape.
 *
 * NOTE on equal-price offers: this fetcher applies NO salePrice<regularPrice drop
 * filter, and it always sets discountedPrice. So EDEKA offers where oldPrice is null
 * (regular==sale) survive the whole pipeline — the normalizer only drops when
 * discountedPrice is absent, and the repository does an unconditional INSERT OR
 * IGNORE.
 */

import { ConsoleLogger, type Logger } from "../../shared/logger.ts";
import { currentWeekSunday } from "../../shared/week.ts";

const HOMEPAGE_URL = "https://www.marktguru.de/";
const SEARCH_ENDPOINT = "https://api.marktguru.de/api/v1/offers/search";
const SEARCH_LIMIT = 1000;
export const DEFAULT_PLZ = "80331";
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

// center = hypermarket, xpress = convenience are different store FORMATS that duplicate the same products, so excluded.
export const EDEKA_ADVERTISERS = ["edeka"];

// marktguru tags brand-less products with a SENTINEL brand record (a real brand
// row whose name is this stable stem plus a varying numeric suffix). It is the
// most common brand value, so it must be treated as NO brand — never leaked into titles.
export const NO_BRAND_SENTINEL = "thisisnobrand";

/**
 * Curated search terms (SSOT). marktguru's API is search-driven — there is no
 * "list all EDEKA offers" endpoint — so we sweep the everyday grocery vocabulary.
 */
const DEFAULT_SEARCH_TERMS = [
  "käse", "wurst", "fleisch", "hähnchen", "hackfleisch", "fisch", "milch",
  "joghurt", "butter", "sahne", "quark", "ei", "brot", "brötchen", "kaffee",
  "tee", "nudeln", "reis", "mehl", "zucker", "öl", "tomaten", "obst", "gemüse",
  "salat", "kartoffeln", "tiefkühl", "pizza", "eis", "schokolade", "chips",
  "kekse", "müsli", "bier", "wein", "saft", "wasser", "limonade", "waschmittel",
  "spülmittel", "toilettenpapier", "windeln", "hund", "katze",
];

interface CatalogueNormalizerItem {
  id: string;
  title: string;
  brand: string | null;
  price: string;
  discountedPrice: string;
  customLabel1: string;
  productType: string;
  photoUrls: string[];
  imageUrl: string | null;
  description: string | null;
  sourceUrl: string;
}

interface Offer {
  id: number;
  product: { id?: number; name: string };
  brand: { name: string } | null;
  price: number;
  oldPrice: number | null;
  categories?: { name: string }[];
  advertisers: { uniqueName: string; name: string }[];
  validityDates?: { from: string; to: string }[];
  images?: { count: number };
  description?: string;
}

export interface MarktguruEdekaCatalogueFetcherOptions {
  plz?: string;
  fetchFn?: typeof fetch;
  searchTerms?: string[];
  logger?: Logger;
}

export class MarktguruEdekaCatalogueFetcher {
  private readonly plz: string;
  private readonly fetchFn: typeof fetch;
  private readonly searchTerms: string[];
  private readonly logger: Logger;

  constructor(opts: MarktguruEdekaCatalogueFetcherOptions = {}) {
    this.plz = opts.plz ?? DEFAULT_PLZ;
    this.fetchFn = opts.fetchFn ?? globalThis.fetch;
    this.searchTerms = opts.searchTerms ?? DEFAULT_SEARCH_TERMS;
    this.logger = opts.logger ?? new ConsoleLogger();
  }

  async fetchCurrentWeek(): Promise<CatalogueNormalizerItem[]> {
    const { apiKey, clientKey } = await this.bootstrapKeys();

    // Collect offers across all terms; dedupe by id as we go.
    const byId = new Map<number, Offer>();
    let extracted = 0;

    for (const term of this.searchTerms) {
      const offers = await this.searchTerm(term, apiKey, clientKey);
      extracted += offers.length;
      for (const offer of offers) {
        if (this.isEdeka(offer) && !byId.has(offer.id)) {
          byId.set(offer.id, offer);
        }
      }
    }

    const seen = new Map<string, Offer>();
    for (const offer of byId.values()) {
      const key = `${offer.product.id ?? offer.product.name}|${offer.price}`;
      const existing = seen.get(key);
      if (!existing) seen.set(key, offer);
      else if (existing.oldPrice == null && offer.oldPrice != null) seen.set(key, offer);
    }

    const kept = [...seen.values()].map((offer) => this.toItem(offer));

    this.logger.log("info", "scrape.edeka.extracted", {
      extracted,
      kept: kept.length,
    });
    return kept;
  }

  /** GET the homepage and scrape apiKey/clientKey from the embedded config JSON. */
  private async bootstrapKeys(): Promise<{ apiKey: string; clientKey: string }> {
    const response = await this.fetchFn(HOMEPAGE_URL);
    const html = await response.text();
    const apiKey = /"apiKey":"([^"]+)"/.exec(html)?.[1];
    const clientKey = /"clientKey":"([^"]+)"/.exec(html)?.[1];
    if (!apiKey || !clientKey) {
      throw new Error(
        "MarktguruEdekaCatalogueFetcher: apiKey/clientKey not found on homepage",
      );
    }
    this.logger.log("info", "scrape.edeka.bootstrap", { apiKeyFound: true });
    return { apiKey, clientKey };
  }

  /**
   * Fetch offers for one search term. Any throw OR non-ok response is logged and
   * turned into an empty result so a single bad term never aborts the run.
   */
  private async searchTerm(
    term: string,
    apiKey: string,
    clientKey: string,
  ): Promise<Offer[]> {
    const url =
      `${SEARCH_ENDPOINT}?as=web&q=${encodeURIComponent(term)}` +
      `&zipCode=${this.plz}&limit=${SEARCH_LIMIT}`;
    try {
      const response = await this.fetchFn(url, {
        headers: {
          "x-apikey": apiKey,
          "x-clientkey": clientKey,
          "User-Agent": USER_AGENT,
        },
      });
      if (!response.ok) {
        this.logger.log("warn", "scrape.edeka.term_failed", {
          term,
          status: response.status,
        });
        return [];
      }
      const body = (await response.json()) as { results?: Offer[] };
      return body.results ?? [];
    } catch (error) {
      this.logger.log("warn", "scrape.edeka.term_failed", {
        term,
        error: String(error),
      });
      return [];
    }
  }

  private isEdeka(offer: Offer): boolean {
    return offer.advertisers.some((a) => EDEKA_ADVERTISERS.includes(a.uniqueName));
  }

  private toItem(offer: Offer): CatalogueNormalizerItem {
    const rawBrand = offer.brand?.name?.trim() ?? "";
    const realBrand = rawBrand && !rawBrand.toLowerCase().includes(NO_BRAND_SENTINEL) ? rawBrand : "";
    const title = realBrand ? `${realBrand} ${offer.product.name}` : offer.product.name;
    const regular = offer.oldPrice ?? offer.price;
    const imageUrl =
      (offer.images?.count ?? 0) > 0
        ? `https://cdn.marktguru.de/api/v1/offers/${offer.id}/images/default/0/large.webp`
        : null;
    return {
      id: String(offer.id),
      title,
      // brand is composed into the title above, so it is not stored separately (avoids
      // duplicate render in the details dialog).
      brand: null,
      price: String(regular),
      discountedPrice: String(offer.price),
      customLabel1: this.latestValidUntil(offer),
      productType: offer.categories?.[0]?.name ?? "grocery",
      photoUrls: [],
      imageUrl,
      description: offer.description ?? null,
      sourceUrl: `https://www.marktguru.de/offers/${offer.id}`,
    };
  }

  /** Latest validityDates.to sliced to YYYY-MM-DD; falls back to end-of-week. */
  private latestValidUntil(offer: Offer): string {
    const dates = offer.validityDates ?? [];
    const latest = dates
      .map((v) => v.to)
      .filter((to) => to.length > 0)
      .sort()
      .at(-1);
    return latest ? latest.slice(0, 10) : currentWeekSunday();
  }
}
