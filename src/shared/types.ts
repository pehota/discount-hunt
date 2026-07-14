/**
 * Shared Kernel — cross-context value types.
 * Consumed by all bounded contexts.
 * No domain logic — type definitions only.
 */

/** Dietary restriction set by user in UserPreferences. */
export type DietaryRestriction = "vegetarian" | "vegan" | "none";

/**
 * Household preferences (increment 1: single dietary dimension).
 * budgetCapCents / household / kid-friendly are deferred until their effect ships.
 */
export interface UserPreferences {
  dietaryRestriction: DietaryRestriction;
}

/** Dietary classification tag applied at scrape time by catalogue-normalizer. */
export type DietaryTag = "vegetarian" | "vegan" | "contains-meat" | "contains-fish" | "unknown";

/** ISO date string representing the Monday of a week (e.g. "2026-07-13"). */
export type WeekStart = string;

/** Monetary amount in euros, stored as integer cents to avoid float precision issues. */
export type Money = number; // cents

/** Unique identifiers — opaque branded strings. */
export type ItemId = string & { readonly __brand: "ItemId" };
export type PlanId = string & { readonly __brand: "PlanId" };
export type MealId = string & { readonly __brand: "MealId" };
export type RecipeId = string & { readonly __brand: "RecipeId" };
export type RecordId = string & { readonly __brand: "RecordId" };
export type JobId = string & { readonly __brand: "JobId" };

/** Normalized discount item produced by the catalogue ACL. */
export interface NormalizedItem {
  externalId: string;
  store: string;
  name: string;
  category: string;
  regularPrice: Money;  // cents; must be > salePrice
  salePrice: Money;     // cents
  validUntil: string;   // ISO date
  dietaryTags: DietaryTag[];
}

/** Meal slot within a day — lunch or dinner. */
export type MealSlot = 'lunch' | 'dinner';

/** A single meal entry in a 7-day plan (14 total: 7 days × 2 slots). */
export interface Meal {
  day: number;       // 1-7 (Monday=1, Sunday=7)
  slot: MealSlot;
  name: string;
  discountItemId: string | null;
}

/** HTTP server configuration. */
export interface ServerConfig {
  port: number;
  dbPath: string;
}

/** Handle returned by createServer to allow graceful shutdown. */
export interface ServerHandle {
  stop(): void;
}
