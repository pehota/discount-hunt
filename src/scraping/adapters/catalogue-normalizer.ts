/**
 * CatalogueNormalizer — ACL: translates store-specific raw catalogue JSON to NormalizedItem[].
 *
 * Responsibilities:
 *   - Filter: discard items where discountedPrice is absent or empty string (D21 / SPIKE-01)
 *   - Map: price → regularPrice (cents), discountedPrice → salePrice (cents)
 *   - Classify: apply dietary keyword classifier to produce dietaryTags[] (runs at scrape time)
 *
 * Contract shape: pure-function / return-only.
 */

import type { NormalizedItem, DietaryTag } from "../../shared/types.ts";

const CENTS_PER_EURO = 100;

interface RawAldiItem {
  id: string;
  title: string;
  brand: string;
  price: string;
  discountedPrice?: string;
  customLabel1: string;
  productType?: string;
  photoUrls: string[];
  sourceUrl?: string | null;
}

export class CatalogueNormalizer {
  normalize(rawItems: unknown[], store: string = "Aldi Süd"): NormalizedItem[] {
    const items = rawItems as RawAldiItem[];
    return items
      .filter(this.hasDiscount)
      .map((item) => this.toNormalizedItem(item, store));
  }

  private hasDiscount(item: RawAldiItem): boolean {
    return item.discountedPrice !== undefined && item.discountedPrice !== "";
  }

  private toNormalizedItem(item: RawAldiItem, store: string): NormalizedItem {
    // Some real Aldi nested products have no productType. Default it to a
    // defined string so category is never undefined (a dropped SQL binding
    // downstream would otherwise emit malformed SQL and crash the insert).
    const category = item.productType ?? "unknown";
    return {
      externalId: item.id,
      store,
      name: item.title,
      category,
      regularPrice: Math.round(parseFloat(item.price) * CENTS_PER_EURO),
      salePrice: Math.round(parseFloat(item.discountedPrice!) * CENTS_PER_EURO),
      validUntil: item.customLabel1,
      dietaryTags: this.classifyDietaryTags(category),
      // ALWAYS set — default null when absent so register() never sees undefined.
      sourceUrl: item.sourceUrl ?? null,
    };
  }

  private classifyDietaryTags(productType: string): DietaryTag[] {
    switch (productType) {
      case "vegetable":
      case "legume":
        return ["vegan", "vegetarian"];
      case "meat":
        return ["contains-meat"];
      case "fish":
        return ["contains-fish"];
      default:
        return [];
    }
  }
}
