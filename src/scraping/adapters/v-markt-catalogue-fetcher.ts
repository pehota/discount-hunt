/**
 * VMarktCatalogueFetcher — ACL adapter for pageflip.v-markt.de.
 *
 * Protocol:
 *   1. GET https://www.v-markt.de/angebote/muenchen — discover slugs from hrefs
 *   2. Filter hrefs matching pageflip.v-markt.de/muenchen/<slug>/ where slug ∈ /^\d{4}_VMMUC$/
 *   3. Select lexicographically latest slug
 *   4. GET https://www.pageflip.v-markt.de/muenchen/{slug}/ — fetch catalogue HTML
 *   5. Extract all <p> text content (strip HTML tags)
 *   6. Delegate to CatalogueExtractor.extractProducts(paragraphs)
 *   7. Filter: keep only entries where salePrice < regularPrice
 *   8. Map to CatalogueNormalizer-compatible shape
 */

import type { CatalogueExtractor } from "./catalogue-extractor.ts";
import { ConsoleLogger, type Logger } from "../../shared/logger.ts";

const DISCOVERY_URL = "https://www.v-markt.de/angebote/muenchen";
/** Source string for slug extraction — used to build a fresh regex per call (g-flag is stateful). */
const SLUG_HREF_SOURCE = String.raw`pageflip\.v-markt\.de\/muenchen\/([^/"]+)`;
const VALID_SLUG_PATTERN = /^\d{4}_VMMUC$/;

interface CatalogueNormalizerItem {
  id: string;
  title: string;
  brand: string;
  price: string;
  discountedPrice: string;
  customLabel1: string;
  productType: string;
  photoUrls: string[];
}

export class VMarktCatalogueFetcher {
  constructor(
    private extractor: CatalogueExtractor,
    private fetchFn = globalThis.fetch,
    private readonly logger: Logger = new ConsoleLogger()
  ) {}

  async fetchCurrentWeek(): Promise<CatalogueNormalizerItem[]> {
    const slug = await this.discoverSlug();
    this.logger.log("info", "scrape.vmarkt.slug", { slug });

    const paragraphs = await this.fetchParagraphs(slug);
    this.logger.log("info", "scrape.vmarkt.paragraphs", { count: paragraphs.length });

    const extracted = await this.extractor.extractProducts(paragraphs);
    const kept = extracted
      .filter(
        ({ regularPrice, salePrice }) =>
          parseFloat(salePrice) < parseFloat(regularPrice)
      )
      .map(({ name, regularPrice, salePrice }) => ({
        id: crypto.randomUUID(),
        title: name,
        brand: "V-Markt",
        price: regularPrice,
        discountedPrice: salePrice,
        customLabel1: new Date().toISOString().slice(5, 10),
        productType: "grocery",
        photoUrls: [],
      }));

    this.logger.log("info", "scrape.vmarkt.extracted", {
      extracted: extracted.length,
      kept: kept.length,
    });
    if (extracted.length > 0 && kept.length === 0) {
      this.logger.log("warn", "scrape.vmarkt.zero_kept", {
        extracted: extracted.length,
        hint: "possible schema drift — check product entry shape",
      });
    }
    return kept;
  }

  private async discoverSlug(): Promise<string> {
    const response = await this.fetchFn(DISCOVERY_URL);
    const html = await response.text();
    const slugs = this.extractSlugs(html);
    const latest = slugs.sort().reverse()[0];
    if (!latest) {
      throw new Error("VMarktCatalogueFetcher: no valid VMMUC slugs found on discovery page");
    }
    return latest;
  }

  private extractSlugs(html: string): string[] {
    const slugs: string[] = [];
    const regex = new RegExp(SLUG_HREF_SOURCE, "g");
    let match: RegExpExecArray | null;
    while ((match = regex.exec(html)) !== null) {
      const slug = match[1];
      if (slug && VALID_SLUG_PATTERN.test(slug)) {
        slugs.push(slug);
      }
    }
    return slugs;
  }

  private async fetchParagraphs(slug: string): Promise<string[]> {
    const url = `https://www.pageflip.v-markt.de/muenchen/${slug}/`;
    const response = await this.fetchFn(url);
    const html = await response.text();
    return this.extractParagraphTexts(html);
  }

  private extractParagraphTexts(html: string): string[] {
    const paragraphs: string[] = [];
    const pTagPattern = /<p>([\s\S]*?)<\/p>/gi;
    let match: RegExpExecArray | null;
    while ((match = pTagPattern.exec(html)) !== null) {
      const text = (match[1] ?? "").replace(/<[^>]*>/g, "").trim();
      if (text.length > 0) {
        paragraphs.push(text);
      }
    }
    return paragraphs;
  }
}
