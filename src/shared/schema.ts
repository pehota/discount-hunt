/**
 * Shared Kernel — Drizzle ORM table schema definitions.
 *
 * All secondary adapters import from here.
 * Only src/{context}/adapters/sqlite-*.ts files may import this module (enforced by dependency-cruiser D34).
 *
 * Tables: discount_items, meal_plans, savings_log, scrape_jobs
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
  scrapeJobId: text("scrape_job_id").notNull(),
  createdAt: integer("created_at").notNull(), // ms since epoch
});

export const mealPlans = sqliteTable("meal_plans", {
  id: text("id").primaryKey(),
  weekStart: text("week_start").notNull(), // ISO Monday
  itemIds: text("item_ids").notNull(), // JSON array
  meals: text("meals").notNull().default("[]"), // JSON array of Meal objects
  totalRegularPrice: integer("total_regular_price").notNull(), // cents
  totalSalePrice: integer("total_sale_price").notNull(), // cents
  estimatedSavings: integer("estimated_savings").notNull(), // cents — D23 atomic
  createdAt: integer("created_at").notNull(), // ms since epoch
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
