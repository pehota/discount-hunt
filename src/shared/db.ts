/**
 * Shared Kernel — SQLite client factory with WAL-mode startup probe.
 *
 * Uses bun:sqlite (Bun's native SQLite) + drizzle-orm/bun-sqlite.
 * better-sqlite3 is listed in package.json but requires a native Node.js addon
 * that is incompatible with the Bun runtime's ABI. bun:sqlite is the correct
 * driver for a Bun-first project.
 *
 * Exports createDb(path) which opens the SQLite file in WAL mode (for file-backed
 * databases; in-memory databases use 'memory' mode by SQLite design) and
 * runs a write-read-delete startup probe before returning.
 * Throws on probe failure (caller should exit 1 on catch — D35 substrate honesty).
 */

import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import * as schema from "./schema.ts";

export type DbClient = ReturnType<typeof drizzle<typeof schema>>;

const CREATE_SCRAPE_JOBS = `
  CREATE TABLE IF NOT EXISTS scrape_jobs (
    id TEXT PRIMARY KEY,
    store TEXT NOT NULL,
    status TEXT NOT NULL,
    started_at INTEGER NOT NULL,
    completed_at INTEGER,
    item_count INTEGER NOT NULL DEFAULT 0,
    error_message TEXT
  )
`;

const CREATE_DISCOUNT_ITEMS = `
  CREATE TABLE IF NOT EXISTS discount_items (
    id TEXT PRIMARY KEY,
    store TEXT NOT NULL,
    name TEXT NOT NULL,
    category TEXT NOT NULL,
    regular_price INTEGER NOT NULL,
    sale_price INTEGER NOT NULL,
    valid_until TEXT NOT NULL,
    dietary_tags TEXT NOT NULL DEFAULT '[]',
    tags TEXT NOT NULL DEFAULT '[]',
    taxonomy_category TEXT,
    source_url TEXT,
    image_url TEXT,
    brand TEXT,
    description TEXT,
    scrape_job_id TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )
`;

const CREATE_MEAL_PLANS = `
  CREATE TABLE IF NOT EXISTS meal_plans (
    id TEXT PRIMARY KEY,
    week_start TEXT NOT NULL,
    item_ids TEXT NOT NULL,
    meals TEXT NOT NULL DEFAULT '[]',
    dietary_filter TEXT NOT NULL DEFAULT 'none',
    budget_cap_cents INTEGER,
    total_regular_price INTEGER NOT NULL,
    total_sale_price INTEGER NOT NULL,
    estimated_savings INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  )
`;

const CREATE_USER_SETTINGS = `
  CREATE TABLE IF NOT EXISTS user_settings (
    user_id TEXT PRIMARY KEY DEFAULT 'dimitar',
    dietary_restriction TEXT NOT NULL DEFAULT 'none',
    budget_cap_cents INTEGER,
    kid_friendly INTEGER NOT NULL DEFAULT 0,
    household_size INTEGER NOT NULL DEFAULT 2,
    cooking_time TEXT NOT NULL DEFAULT 'any',
    meal_types TEXT NOT NULL DEFAULT '["lunch","dinner"]',
    updated_at INTEGER NOT NULL
  )
`;

const CREATE_SAVINGS_LOG = `
  CREATE TABLE IF NOT EXISTS savings_log (
    id TEXT PRIMARY KEY,
    plan_id TEXT NOT NULL,
    week_start TEXT NOT NULL,
    saved_amount INTEGER NOT NULL,
    total_sale_price INTEGER NOT NULL,
    total_regular_price INTEGER NOT NULL,
    item_count INTEGER NOT NULL,
    recorded_at INTEGER NOT NULL
  )
`;

const CREATE_RECIPES = `
  CREATE TABLE IF NOT EXISTS recipes (
    id TEXT PRIMARY KEY,
    query_key TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    cached_content TEXT NOT NULL,
    source_url TEXT NOT NULL,
    source_url_valid INTEGER NOT NULL DEFAULT 1,
    cached_at INTEGER NOT NULL
  )
`;

const CREATE_SHOPPING_LIST_ITEMS = `
  CREATE TABLE IF NOT EXISTS shopping_list_items (
    id TEXT PRIMARY KEY,
    week_start TEXT NOT NULL,
    source TEXT NOT NULL,
    name TEXT NOT NULL,
    store TEXT,
    sale_price_cents INTEGER,
    regular_price_cents INTEGER,
    discount_item_id TEXT,
    taxonomy_category TEXT,
    added_at INTEGER NOT NULL
  )
`;

const PROBE_ID = "__probe__";

export function createDb(dbPath: string): DbClient {
  const sqlite = new Database(dbPath);

  // Enable WAL mode (no-op on :memory: — returns 'memory', not 'wal', by SQLite design)
  sqlite.exec("PRAGMA journal_mode=WAL");

  // Create all tables
  sqlite.exec(CREATE_SCRAPE_JOBS);
  sqlite.exec(CREATE_DISCOUNT_ITEMS);
  sqlite.exec(CREATE_MEAL_PLANS);
  sqlite.exec(CREATE_USER_SETTINGS);

  // Idempotent migration: add meals column if the table pre-dates it
  try {
    sqlite.exec("ALTER TABLE meal_plans ADD COLUMN meals TEXT NOT NULL DEFAULT '[]'");
  } catch {
    // Column already exists — expected for fresh databases created with the current schema
  }

  // Idempotent migration: add dietary_filter column if the table pre-dates it
  try {
    sqlite.exec("ALTER TABLE meal_plans ADD COLUMN dietary_filter TEXT NOT NULL DEFAULT 'none'");
  } catch {
    // Column already exists — expected for fresh databases created with the current schema
  }

  // Idempotent migration: add budget_cap_cents (nullable) to meal_plans if the table pre-dates it
  try {
    sqlite.exec("ALTER TABLE meal_plans ADD COLUMN budget_cap_cents INTEGER");
  } catch {
    // Column already exists — expected for fresh databases created with the current schema
  }

  // Idempotent migration: add budget_cap_cents (nullable) to user_settings if the table pre-dates it
  try {
    sqlite.exec("ALTER TABLE user_settings ADD COLUMN budget_cap_cents INTEGER");
  } catch {
    // Column already exists — expected for fresh databases created with the current schema
  }

  // Idempotent migrations: add phase-12 recipe-search params to user_settings if the table pre-dates them
  try {
    sqlite.exec("ALTER TABLE user_settings ADD COLUMN kid_friendly INTEGER NOT NULL DEFAULT 0");
  } catch {
    // Column already exists — expected for fresh databases created with the current schema
  }

  try {
    sqlite.exec("ALTER TABLE user_settings ADD COLUMN household_size INTEGER NOT NULL DEFAULT 2");
  } catch {
    // Column already exists — expected for fresh databases created with the current schema
  }

  try {
    sqlite.exec("ALTER TABLE user_settings ADD COLUMN cooking_time TEXT NOT NULL DEFAULT 'any'");
  } catch {
    // Column already exists — expected for fresh databases created with the current schema
  }

  try {
    sqlite.exec(`ALTER TABLE user_settings ADD COLUMN meal_types TEXT NOT NULL DEFAULT '["lunch","dinner"]'`);
  } catch {
    // Column already exists — expected for fresh databases created with the current schema
  }

  // Idempotent migration: add taxonomy_category (nullable) to discount_items if the table pre-dates it
  try {
    sqlite.exec("ALTER TABLE discount_items ADD COLUMN taxonomy_category TEXT");
  } catch {
    // Column already exists — expected for fresh databases created with the current schema
  }

  // Idempotent migration: add tags column to discount_items if the table pre-dates it
  try {
    sqlite.exec("ALTER TABLE discount_items ADD COLUMN tags TEXT NOT NULL DEFAULT '[]'");
  } catch {
    // Column already exists — expected for fresh databases created with the current schema
  }

  // Idempotent migration: add source_url (nullable) to discount_items if the table pre-dates it
  try {
    sqlite.exec("ALTER TABLE discount_items ADD COLUMN source_url TEXT");
  } catch {
    // Column already exists — expected for fresh databases created with the current schema
  }

  // Idempotent migration: add image_url (nullable) to discount_items if the table pre-dates it
  try {
    sqlite.exec("ALTER TABLE discount_items ADD COLUMN image_url TEXT");
  } catch {
    // Column already exists — expected for fresh databases created with the current schema
  }

  // Idempotent migration: add brand (nullable) to discount_items if the table pre-dates it
  try {
    sqlite.exec("ALTER TABLE discount_items ADD COLUMN brand TEXT");
  } catch {
    // Column already exists — expected for fresh databases created with the current schema
  }

  // Idempotent migration: add description (nullable) to discount_items if the table pre-dates it
  try {
    sqlite.exec("ALTER TABLE discount_items ADD COLUMN description TEXT");
  } catch {
    // Column already exists — expected for fresh databases created with the current schema
  }

  sqlite.exec(CREATE_SAVINGS_LOG);
  sqlite.exec(CREATE_RECIPES);
  sqlite.exec(CREATE_SHOPPING_LIST_ITEMS);

  // Idempotent migration: add taxonomy_category (nullable) to shopping_list_items if the table pre-dates it
  try {
    sqlite.exec("ALTER TABLE shopping_list_items ADD COLUMN taxonomy_category TEXT");
  } catch {
    // Column already exists — expected for fresh databases created with the current schema
  }

  // Write-read-delete probe on scrape_jobs to verify R/W access
  const insert = sqlite.prepare(
    "INSERT INTO scrape_jobs (id, store, status, started_at, item_count) VALUES (?, ?, ?, ?, ?)"
  );
  insert.run(PROBE_ID, PROBE_ID, "running", Date.now(), 0);

  const row = sqlite.prepare("SELECT id FROM scrape_jobs WHERE id = ?").get(PROBE_ID);
  if (!row || (row as { id: string }).id !== PROBE_ID) {
    throw new Error("DB startup probe failed: write-read check did not return probe row");
  }

  sqlite.prepare("DELETE FROM scrape_jobs WHERE id = ?").run(PROBE_ID);

  const deleted = sqlite.prepare("SELECT id FROM scrape_jobs WHERE id = ?").get(PROBE_ID);
  if (deleted !== null) {
    throw new Error("DB startup probe failed: delete did not remove probe row");
  }

  return drizzle(sqlite, { schema });
}
