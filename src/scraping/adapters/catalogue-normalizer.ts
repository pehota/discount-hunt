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

interface RawAldiItem {
  id: string;
  title: string;
  brand: string;
  price: string;
  discountedPrice?: string;
  customLabel1: string;
  productType: string;
  photoUrls: string[];
}

export class CatalogueNormalizer {
  normalize(rawItems: unknown[]): NormalizedItem[] {
    const items = rawItems as RawAldiItem[];
    return items
      .filter((item) => item.discountedPrice !== undefined && item.discountedPrice !== "")
      .map((item) => ({
        externalId: item.id,
        store: "aldi-sud",
        name: item.title,
        category: item.productType,
        regularPrice: Math.round(parseFloat(item.price) * 100),
        salePrice: Math.round(parseFloat(item.discountedPrice!) * 100),
        validUntil: item.customLabel1,
        dietaryTags: this.classifyDietaryTags(item.productType),
      }));
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
