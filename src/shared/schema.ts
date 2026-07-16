/**
 * Shared Kernel — Drizzle ORM table schema definitions.
 *
 * All secondary adapters import from here.
 * Only src/{context}/adapters/sqlite-*.ts files may import this module (enforced by dependency-cruiser D34).
 *
 * Tables: discount_items, meal_plans, savings_log, scrape_jobs, shopping_list_items
 */

import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

export const scrapeJobs = sqliteTable("scrape_jobs", {
  id: text("id").primaryKey(),
  store: text("store").notNull(),
  status: text("status").notNull(), // 'running' | 'completed' | 'failed'
  startedAt: integer("started_at").notNull(), // ms since epoch
  completedAt: integer("completed_at"), // nullable
  itemCount: integer("item_count").notNull().default(0),
  errorMessage: text("error_message"), // nullable
});

export const discountItems = sqliteTable("discount_items", {
  id: text("id").primaryKey(),
  store: text("store").notNull(),
  name: text("name").notNull(),
  category: text("category").notNull(),
  regularPrice: integer("regular_price").notNull(), // cents — D22 write-once
  salePrice: integer("sale_price").notNull(), // cents
  validUntil: text("valid_until").notNull(), // ISO date
  dietaryTags: text("dietary_tags").notNull().default("[]"), // JSON array
  tags: text("tags").notNull().default("[]"), // JSON array of Tag
  taxonomyCategory: text("taxonomy_category"), // nullable — assigned by categorisation context; NULL = unclassified
  sourceUrl: text("source_url"), // nullable — deep link to original store offer; NULL when unavailable
  imageUrl: text("image_url"), // nullable — product image; NULL when the source can't provide it
  brand: text("brand"), // nullable — product brand; NULL when the source can't provide it
  description: text("description"), // nullable — product description; NULL when the source can't provide it
  scrapeJobId: text("scrape_job_id").notNull(),
  createdAt: integer("created_at").notNull(), // ms since epoch
});

export const mealPlans = sqliteTable("meal_plans", {
  id: text("id").primaryKey(),
  weekStart: text("week_start").notNull(), // ISO Monday
  itemIds: text("item_ids").notNull(), // JSON array
  meals: text("meals").notNull().default("[]"), // JSON array of Meal objects
  dietaryFilter: text("dietary_filter").notNull().default("none"), // snapshotted restriction (D25)
  budgetCapCents: integer("budget_cap_cents"), // nullable snapshot; NULL = no cap
  totalRegularPrice: integer("total_regular_price").notNull(), // cents
  totalSalePrice: integer("total_sale_price").notNull(), // cents
  estimatedSavings: integer("estimated_savings").notNull(), // cents — D23 atomic
  createdAt: integer("created_at").notNull(), // ms since epoch
});

export const userSettings = sqliteTable("user_settings", {
  userId: text("user_id").primaryKey().default("dimitar"), // single-user singleton (D9)
  dietaryRestriction: text("dietary_restriction").notNull().default("none"), // 'none'|'vegetarian'|'vegan'
  budgetCapCents: integer("budget_cap_cents"), // nullable weekly cap; NULL = no cap
  kidFriendly: integer("kid_friendly").notNull().default(0), // SQLite boolean (0/1)
  householdSize: integer("household_size").notNull().default(2), // people to cook for (1–12)
  cookingTime: text("cooking_time").notNull().default("any"), // 'any'|'quick'
  mealTypes: text("meal_types").notNull().default('["lunch","dinner"]'), // JSON array of MealSlot
  updatedAt: integer("updated_at").notNull(), // ms since epoch
});

export const recipes = sqliteTable("recipes", {
  id: text("id").primaryKey(),
  queryKey: text("query_key").notNull().unique(), // normalized meal/ingredient name; cache-by-query
  name: text("name").notNull(),
  cachedContent: text("cached_content").notNull(), // JSON { ingredients: string[], steps: string[] } — NOT NULL
  sourceUrl: text("source_url").notNull(), // url ?? mainEntityOfPage from JSON-LD
  sourceUrlValid: integer("source_url_valid").notNull().default(1), // SQLite boolean (0/1)
  cachedAt: integer("cached_at").notNull(), // ms epoch — canonical freshness, TTL 7 days
});

export const shoppingListItems = sqliteTable("shopping_list_items", {
  id: text("id").primaryKey(),
  weekStart: text("week_start").notNull(), // ISO Monday
  source: text("source").notNull(), // 'discount' | 'manual'
  name: text("name").notNull(),
  store: text("store"), // nullable — manual rows have no store
  salePriceCents: integer("sale_price_cents"), // nullable — cents snapshot
  regularPriceCents: integer("regular_price_cents"), // nullable — cents snapshot
  discountItemId: text("discount_item_id"), // nullable — null for manual rows
  taxonomyCategory: text("taxonomy_category"), // nullable in DB (legacy rows); coalesced → "Other" on read
  addedAt: integer("added_at").notNull(), // ms since epoch
});

export const savingsLog = sqliteTable("savings_log", {
  id: text("id").primaryKey(),
  planId: text("plan_id").notNull(),
  weekStart: text("week_start").notNull(),
  savedAmount: integer("saved_amount").notNull(), // cents — D23: must equal estimated_savings
  totalSalePrice: integer("total_sale_price").notNull(),
  totalRegularPrice: integer("total_regular_price").notNull(),
  itemCount: integer("item_count").notNull(),
  recordedAt: integer("recorded_at").notNull(), // ms since epoch
});
