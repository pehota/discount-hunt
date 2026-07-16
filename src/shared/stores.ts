/**
 * Shared Kernel — canonical store registry (single source of truth).
 *
 * `STORES` is the authoritative list of the three stores the system scrapes.
 * `slugify` derives a URL-safe slug from a store name; used by repositories'
 * get-or-create path when auto-registering a store name that is not canonical.
 */

export const STORES = [
  { name: "Aldi Süd", slug: "aldi-sued" },
  { name: "EDEKA", slug: "edeka" },
  { name: "V-Markt", slug: "v-markt" },
] as const;

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
