/**
 * Shared Kernel — cross-context value types.
 * Consumed by all bounded contexts.
 * No domain logic — type definitions only.
 */

/** Dietary restriction set by user in UserPreferences. */
export type DietaryRestriction = "vegetarian" | "vegan" | "none";

/** Cooking-time preference for recipe search. 'any' = no constraint, 'quick' = fast recipes only. */
export type CookingTime = "any" | "quick";

/**
 * Household preferences.
 * increment 1: dietary dimension. increment 1.5: budget cap (euros stored as cents).
 * phase 12: recipe-search params (kid-friendly, household size, cooking time, meal types).
 * Optional fields carry sane defaults on read (mirrors budgetCapCents idiom): the repo's
 * get() always returns concrete values, upsert() coalesces undefined → default before writing.
 * budgetCapCents null / undefined = no cap.
 */
export interface UserPreferences {
  dietaryRestriction: DietaryRestriction;
  budgetCapCents?: number | null;
  /** Prefer kid-friendly recipes. Default false. */
  kidFriendly?: boolean;
  /** Number of people to cook for. Default 2, valid 1–12. */
  householdSize?: number;
  /** Cooking-time constraint. Default 'any'. */
  cookingTime?: CookingTime;
  /** Which plan slots get recipe suggestions. Default ['lunch','dinner']. */
  mealTypes?: MealSlot[];
}

/** Dietary classification tag applied at scrape time by catalogue-normalizer. */
export type DietaryTag = "vegetarian" | "vegan" | "contains-meat" | "contains-fish" | "unknown";

/**
 * Coarse product taxonomy — the classified shelf/aisle bucket a discount item
 * belongs to. Assigned by the categorisation context (the LLM classifies every
 * item), stored in discount_items.taxonomy_category (nullable = not yet
 * classified). Buckets describe what a food fundamentally IS, not its storage
 * temperature (frozen fish → Meat & Fish, ice cream → Snacks & Sweets).
 * "Other" is the final, unclassifiable bucket.
 */
export type TaxonomyCategory =
  | "Produce" | "Meat & Fish" | "Dairy & Cheese" | "Bakery"
  | "Pantry" | "Snacks & Sweets" | "Drinks"
  | "Household" | "Other";

/** The ONE canonical taxonomy list. Consumers import this — never re-list the literals. */
export const TAXONOMY_CATEGORIES: readonly TaxonomyCategory[] = [
  "Produce", "Meat & Fish", "Dairy & Cheese", "Bakery",
  "Pantry", "Snacks & Sweets", "Drinks", "Household", "Other",
];

/**
 * Type guard for taxonomy membership. Needed under strict mode: calling
 * `TAXONOMY_CATEGORIES.includes(x)` with `x: string` is rejected by the
 * readonly union's `.includes`, so we widen to `readonly string[]` here.
 */
export function isTaxonomyCategory(value: string): value is TaxonomyCategory {
  return (TAXONOMY_CATEGORIES as readonly string[]).includes(value);
}

/**
 * Cross-cutting product tags — additive labels that span taxonomy categories
 * (e.g. frozen fish is category "Meat & Fish" AND tag "Frozen"). An item carries
 * ZERO OR MORE tags. Assigned by the categorisation context alongside the single
 * food-type taxonomy_category; only members of TAGS are ever stored (unknowns are
 * coerced/dropped). Tags do NOT replace or duplicate the taxonomy category.
 */
export type Tag = "Frozen" | "Organic" | "Vegan" | "Vegetarian" | "Alcoholic";

/** The ONE canonical tag list. Consumers import this — never re-list the literals. */
export const TAGS: readonly Tag[] = ["Frozen", "Organic", "Vegan", "Vegetarian", "Alcoholic"];

/**
 * Type guard for tag membership. Widens to `readonly string[]` for the same
 * strict-mode reason as isTaxonomyCategory (readonly union `.includes` rejects `string`).
 */
export function isTag(value: string): value is Tag {
  return (TAGS as readonly string[]).includes(value);
}

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
  sourceUrl: string | null;  // deep link to the original store offer; null when unavailable
  imageUrl: string | null;  // product image; null when the source can't provide it
  brand: string | null;  // product brand; null when the source can't provide it
  description: string | null;  // product description; null when the source can't provide it
}

/** Meal slot within a day — lunch or dinner. */
export type MealSlot = 'lunch' | 'dinner';

/** A single meal entry in a 7-day plan (14 total: 7 days × 2 slots). */
export interface Meal {
  day: number;       // 1-7 (Monday=1, Sunday=7)
  slot: MealSlot;
  name: string;
  discountItemId: string | null;
  /**
   * Real-recipe draft fields (S01b), optional so every existing Meal producer/consumer
   * compiles untouched. Present only on draft meals built from a VerifiedCandidate:
   *   - sourceUrl: the recipe's source page the title links to
   *   - usedDiscountItemIds: the discounted products whose names appear in the recipe
   */
  sourceUrl?: string;
  usedDiscountItemIds?: readonly string[];
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
