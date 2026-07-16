/**
 * Store registry — the single get-or-create for resolving a store NAME to its
 * stores.id (name-at-boundary). Used by the discount + scrape-job repositories
 * and by test seeding, so the logic lives in ONE place.
 *
 * Uses raw `sql` (not the Drizzle table objects) so non-adapter modules can call
 * it without importing the schema (keeps the adapter-only-imports-schema rule).
 *
 * Slug uniqueness: `stores.slug` is UNIQUE, but slugify() lowercases, so distinct
 * names can collide (e.g. "EDEKA" and "Edeka" → "edeka"). We therefore look up by
 * NAME (the identity) first and, when creating, disambiguate the slug (`-2`, `-3`,
 * …) instead of relying on INSERT OR IGNORE — which would silently drop the row on
 * a slug clash and leave the name unresolvable.
 */

import { sql } from "drizzle-orm";
import { slugify } from "./stores.ts";

/** Minimal surface both the Drizzle client and test clients satisfy. */
export interface StoreRegistryDb {
  run: (query: ReturnType<typeof sql>) => unknown;
  get: (query: ReturnType<typeof sql>) => unknown;
}

// drizzle bun-sqlite `db.get(sql`...`)` returns a POSITIONAL array of the selected
// columns (e.g. `[2]`), NOT a keyed object — so we read index [0].
type IdRow = [number] | null | undefined;

/** Resolve a store NAME to its id, creating the row (with a unique slug) on first sight. */
export function getOrCreateStoreId(db: StoreRegistryDb, name: string): number {
  const existing = db.get(sql`SELECT id FROM stores WHERE name = ${name}`) as IdRow;
  if (existing) return existing[0];

  let slug = slugify(name);
  const base = slug;
  for (let n = 2; db.get(sql`SELECT 1 FROM stores WHERE slug = ${slug}`); n++) {
    slug = `${base}-${n}`;
  }

  db.run(sql`INSERT INTO stores (name, slug, created_at) VALUES (${name}, ${slug}, ${Date.now()})`);
  const row = db.get(sql`SELECT id FROM stores WHERE name = ${name}`) as IdRow;
  if (!row) throw new Error(`getOrCreateStoreId: store '${name}' not resolvable after insert`);
  return row[0];
}

/** Resolve a store NAME to id WITHOUT creating it; null when the store is unknown. */
export function findStoreId(db: StoreRegistryDb, name: string): number | null {
  const row = db.get(sql`SELECT id FROM stores WHERE name = ${name}`) as IdRow;
  return row ? row[0] : null;
}
