/**
 * AldiSudCatalogueFetcher — ACL adapter for prospekt.aldi-sued.de.
 *
 * Implements CatalogueFetcher port (production adapter).
 * Protocol (SPIKE-01 addendum):
 *   1. HEAD https://prospekt.aldi-sued.de/ → 302 Location: //prospekt.aldi-sued.de/kw{N}-{yy}-op-mp/
 *   2. Parse slug from 302 Location header
 *   3. GET https://cdn.publitas.com/.../{slug}/hotspots_data.json?page={1,2,3,...}
 *   4. Return raw items array (JSON)
 *
 * Substrate probe: catalogue-probe.ts validates slug pattern + item shape per run.
 */

export const __SCAFFOLD__ = true as const;

export class AldiSudCatalogueFetcher {
  async fetchCurrentWeek(): Promise<unknown[]> {
    throw new Error("Not yet implemented — RED scaffold");
  }

  private async discoverSlug(): Promise<string> {
    throw new Error("Not yet implemented — RED scaffold");
  }

  private async fetchPage(slug: string, page: number): Promise<unknown[]> {
    throw new Error("Not yet implemented — RED scaffold");
  }
}
