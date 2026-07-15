/**
 * AldiSudCatalogueFetcher — ACL adapter for prospekt.aldi-sued.de.
 *
 * Implements CatalogueFetcher port (production adapter).
 * Protocol (SPIKE-01 + SPIKE 2026-07-15 addendum):
 *   1. HEAD https://prospekt.aldi-sued.de/ → 302 Location: //prospekt.aldi-sued.de/kw{N}-{yy}-op-mp/
 *   2. Parse slug from 302 Location header
 *   3. GET .../${slug}/page/${p}-${p+1}/hotspots_data.json for p=1,3,5,… (NON-overlapping ranges)
 *   4. Loop pages until 404. A type:"product" entry carries its data in a NESTED products[] array.
 *      Flatten nested products, dedupe by id, keep genuine deals (discountedPrice < price),
 *      and map to the CatalogueNormalizer RawAldiItem shape with an ISO end-of-week validUntil.
 *
 * NOTE (deferred): real productType strings are German (e.g. "Gemüse - Tomaten"), so the
 * downstream dietary classifier tags nothing — separate follow-up, not fixed here.
 *
 * Substrate probe: catalogue-probe.ts validates slug pattern + item shape per run.
 */

import { ConsoleLogger, type Logger } from "../../shared/logger.ts";
import { currentWeekMonday } from "../../shared/week.ts";

const ALDI_SUD_ORIGIN = "https://prospekt.aldi-sued.de";
const SLUG_PATTERN = /^\/\/prospekt\.aldi-sued\.de\/([^/]+)\//;
const PRODUCT_TYPE = "product";
const ALDI_SUD_BRAND = "Aldi Süd";
const DAYS_TO_END_OF_WEEK = 6;

/**
 * Exported pure function — parse slug from a 302 Location header value.
 * Throws AldiSudFetchError if the header is absent or does not match the expected pattern.
 */
export function parseSlug(location: string | null | undefined): string {
  if (!location) {
    throw new AldiSudFetchError("Missing Location header in HEAD response");
  }
  const match = SLUG_PATTERN.exec(location);
  if (!match) {
    throw new AldiSudFetchError(
      `Location header did not match expected pattern: ${location}`
    );
  }
  return match[1];
}

export class AldiSudFetchError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = "AldiSudFetchError";
  }
}

/** A nested product inside a type:"product" hotspot entry's products[] array. */
interface NestedProduct {
  id: string;
  title: string;
  price: string;
  discountedPrice?: string;
  productType: string;
  customLabel1: string;
  photoUrls?: string[];
}

/** A top-level hotspot entry; product entries carry data in a nested products[] array. */
interface HotspotEntry {
  type: string;
  products?: NestedProduct[];
}

/** Output shape consumed by CatalogueNormalizer (RawAldiItem). */
interface RawAldiItem {
  id: string;
  title: string;
  brand: string;
  price: string;
  discountedPrice: string;
  customLabel1: string;
  productType: string;
  photoUrls: string[];
}

export class AldiSudCatalogueFetcher {
  constructor(private readonly logger: Logger = new ConsoleLogger()) {}

  async fetchCurrentWeek(): Promise<RawAldiItem[]> {
    const slug = await this.discoverSlug();
    this.logger.log("info", "scrape.aldi.slug", { slug });

    const nestedProducts = await this.collectNestedProducts(slug);

    const validUntil = this.endOfCurrentWeekIso();
    const kept = nestedProducts
      .filter((product) => this.isGenuineDeal(product))
      .map((product) => this.toRawAldiItem(product, validUntil));

    const rawTotal = nestedProducts.length;
    this.logger.log("info", "scrape.aldi.fetched", { rawTotal, kept: kept.length });
    if (rawTotal > 0 && kept.length === 0) {
      this.logger.log("warn", "scrape.aldi.zero_kept", {
        rawTotal,
        hint: "possible schema drift — check product entry shape",
      });
    }
    return kept;
  }

  /** Walk non-overlapping page ranges (1-2, 3-4, …), flatten + dedupe nested products by id. */
  private async collectNestedProducts(slug: string): Promise<NestedProduct[]> {
    const byId = new Map<string, NestedProduct>();
    let page = 1;
    while (true) {
      const entries = await this.fetchPage(slug, page);
      if (entries.length === 0) break;

      const nested = this.flattenNestedProducts(entries);
      this.logger.log("info", "scrape.aldi.page", { page, count: nested.length });
      for (const product of nested) {
        if (!byId.has(product.id)) {
          byId.set(product.id, product);
        }
      }
      page += 2;
    }
    return [...byId.values()];
  }

  private flattenNestedProducts(entries: HotspotEntry[]): NestedProduct[] {
    return entries
      .filter((entry) => entry.type === PRODUCT_TYPE && Array.isArray(entry.products))
      .flatMap((entry) => entry.products!);
  }

  private isGenuineDeal(product: NestedProduct): boolean {
    if (product.discountedPrice === undefined || product.discountedPrice === "") {
      return false;
    }
    return parseFloat(product.discountedPrice) < parseFloat(product.price);
  }

  private toRawAldiItem(product: NestedProduct, validUntil: string): RawAldiItem {
    return {
      id: product.id,
      title: product.title,
      brand: ALDI_SUD_BRAND,
      price: product.price,
      discountedPrice: product.discountedPrice!,
      customLabel1: validUntil,
      productType: product.productType,
      photoUrls: [],
    };
  }

  /** ISO "YYYY-MM-DD" end-of-current-week = Monday + 6 days (UTC). */
  private endOfCurrentWeekIso(): string {
    const endOfWeek = new Date(`${currentWeekMonday()}T00:00:00Z`);
    endOfWeek.setUTCDate(endOfWeek.getUTCDate() + DAYS_TO_END_OF_WEEK);
    return endOfWeek.toISOString().slice(0, 10);
  }

  private async discoverSlug(): Promise<string> {
    let response: Response;
    try {
      response = await fetch(`${ALDI_SUD_ORIGIN}/`, {
        method: "HEAD",
        redirect: "manual",
      });
    } catch (cause) {
      throw new AldiSudFetchError("HEAD request to ALDI Süd failed", cause);
    }

    const location = response.headers.get("Location");
    return parseSlug(location);
  }

  private async fetchPage(slug: string, page: number): Promise<HotspotEntry[]> {
    const url = `${ALDI_SUD_ORIGIN}/${slug}/page/${page}-${page + 1}/hotspots_data.json`;
    const response = await fetch(url);

    if (response.status === 404) {
      return [];
    }

    if (!response.ok) {
      throw new AldiSudFetchError(
        `Unexpected status ${response.status} fetching page ${page} of ${slug}`
      );
    }

    return response.json() as Promise<HotspotEntry[]>;
  }
}
