/**
 * AldiSudCatalogueFetcher — ACL adapter for prospekt.aldi-sued.de.
 *
 * Implements CatalogueFetcher port (production adapter).
 * Protocol (SPIKE-01 addendum):
 *   1. HEAD https://prospekt.aldi-sued.de/ → 302 Location: //prospekt.aldi-sued.de/kw{N}-{yy}-op-mp/
 *   2. Parse slug from 302 Location header
 *   3. GET https://prospekt.aldi-sued.de/${slug}/page/${page}-${page+1}/hotspots_data.json
 *   4. Loop pages until 404; filter and return product items with genuine discount
 *
 * Substrate probe: catalogue-probe.ts validates slug pattern + item shape per run.
 */

const ALDI_SUD_ORIGIN = "https://prospekt.aldi-sued.de";
const SLUG_PATTERN = /^\/\/prospekt\.aldi-sued\.de\/([^/]+)\//;
const PRODUCT_TYPE = "product";

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

interface HotspotEntry {
  type: string;
  id: string;
  title: string;
  brand: string;
  price: string;
  discountedPrice?: string;
  customLabel1: string;
  productType: string;
  photoUrls: string[];
}

export class AldiSudCatalogueFetcher {
  async fetchCurrentWeek(): Promise<HotspotEntry[]> {
    const slug = await this.discoverSlug();

    const pages: HotspotEntry[] = [];
    let page = 1;
    while (true) {
      const items = await this.fetchPage(slug, page);
      if (items.length === 0) break;
      pages.push(...items);
      page++;
    }

    return pages.filter((entry) => this.isDiscountedProduct(entry));
  }

  private isDiscountedProduct(entry: HotspotEntry): boolean {
    return (
      entry.type === PRODUCT_TYPE &&
      entry.discountedPrice !== undefined &&
      entry.discountedPrice !== "" &&
      parseFloat(entry.discountedPrice) < parseFloat(entry.price)
    );
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
