/**
 * FakeVMarktCatalogueAdapter — in-memory double for the V-Markt CatalogueFetcher port.
 *
 * Walking skeleton seam — Slice-01 extension (SPIKE-03).
 * Returns a fixed set of CatalogueItem objects loaded from a JSON fixture file.
 *
 * Fixture JSON shape mirrors the Aldi fixture (CatalogueItem) so both stores
 * share the CatalogueNormalizer ACL at this skeleton stage. LLM-assisted
 * extraction (real V-Markt shape) is deferred to Slice-02 DELIVER.
 *
 * File-backed mode: reads from FAKE_VMARKT_FIXTURE env var path.
 */

import { readFileSync } from "node:fs";
import type { CatalogueItem } from "./fake-aldi-catalogue-adapter.ts";

export class FakeVMarktCatalogueAdapter {
  constructor(private readonly items: CatalogueItem[]) {}

  static fromFixtureFile(fixturePath: string): FakeVMarktCatalogueAdapter {
    const contents = readFileSync(fixturePath, "utf8");
    const items = JSON.parse(contents) as CatalogueItem[];
    return new FakeVMarktCatalogueAdapter(items);
  }

  async fetchCurrentWeek(): Promise<CatalogueItem[]> {
    return this.items;
  }
}
