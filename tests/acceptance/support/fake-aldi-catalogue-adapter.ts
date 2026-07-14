/**
 * FakeAldiCatalogueAdapter — in-memory double for the CatalogueFetcher port.
 *
 * Used in two modes:
 *   1. In-process: constructed with catalogue items, injected at composition root.
 *   2. File-backed (subprocess seam): reads from FAKE_CATALOGUE_FIXTURE env var path.
 *      The scraper-runner.ts reads CATALOGUE_SOURCE=fake and instantiates this adapter
 *      with items parsed from the fixture file.
 *
 * Fixture JSON shape matches prospekt.aldi-sued.de (SPIKE-01 addendum):
 *   { id, title, brand, price, discountedPrice?, customLabel1, productType, photoUrls[] }
 *   price = regular_price (string), discountedPrice = sale_price (string, optional)
 */

import { readFileSync } from "node:fs";

export interface CatalogueItem {
  id: string;
  title: string;
  brand: string;
  price: string;           // regular_price
  discountedPrice?: string; // sale_price — only present when item is on sale
  customLabel1: string;    // valid-from date (ISO)
  productType: string;
  photoUrls: string[];
}

export class FakeAldiCatalogueAdapter {
  constructor(private readonly items: CatalogueItem[]) {}

  static fromFixtureFile(fixturePath: string): FakeAldiCatalogueAdapter {
    const contents = readFileSync(fixturePath, "utf8");
    const items = JSON.parse(contents) as CatalogueItem[];
    return new FakeAldiCatalogueAdapter(items);
  }

  async fetchCurrentWeek(): Promise<CatalogueItem[]> {
    return this.items;
  }
}
