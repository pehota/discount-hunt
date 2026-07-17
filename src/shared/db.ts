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
import { is } from "drizzle-orm";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { getTableConfig, SQLiteTable } from "drizzle-orm/sqlite-core";
import * as schema from "./schema.ts";
import { generateCreateTableSql, generateMissingColumnAlters } from "./schema-ddl.ts";
import { STORES, slugify } from "./stores.ts";

export type DbClient = ReturnType<typeof drizzle<typeof schema>>;

const PROBE_ID = "__probe__";

export function createDb(dbPath: string): DbClient {
  const sqlite = new Database(dbPath);

  // Enable WAL mode (no-op on :memory: — returns 'memory', not 'wal', by SQLite design)
  sqlite.exec("PRAGMA journal_mode=WAL");

  // FK enforcement stays OFF during table creation + the legacy rebuild below
  // (table rebuilds — DROP + RENAME — MUST run with foreign_keys OFF). It is
  // turned ON near the end, before the probe, so normal operation enforces FKs.
  sqlite.exec("PRAGMA foreign_keys=OFF");

  // Create EVERY table declared in schema.ts (single source of truth via the
  // runtime DDL generator). stores FIRST — it is the FK target for
  // scrape_jobs/discount_items/offer_history, and the seed loop below needs it.
  // CREATE TABLE IF NOT EXISTS makes every statement a no-op on an existing
  // populated DB; the legacy store→store_id rebuild below still runs for old dbs.
  const allTables = (Object.values(schema) as unknown[]).filter((t): t is SQLiteTable =>
    is(t, SQLiteTable)
  );
  const ordered = [schema.stores as SQLiteTable, ...allTables.filter((t) => t !== schema.stores)];
  for (const t of ordered) sqlite.exec(generateCreateTableSql(t));

  // Seed canonical stores (idempotent). Uses the canonical slug, never slugify()
  // (slugify("Aldi Süd") = "aldi-s-d"); the SSOT slugs are the correct values.
  const seedStore = sqlite.prepare(
    "INSERT OR IGNORE INTO stores (name, slug, created_at) VALUES (?, ?, ?)"
  );
  for (const store of STORES) {
    seedStore.run(store.name, store.slug, Date.now());
  }

  // Schema-driven column heal: ADD any schema.ts column missing from a legacy
  // table (generated from schema.ts — no hand-listed ALTERs). Fresh dbs already
  // have every column → no-op. Runs BEFORE the store→store_id rebuild: that
  // rebuild's discount_items SELECT reads tags/taxonomy_category/source_url/…, so
  // those columns must be healed onto the old table first. store_id is safe under
  // this order too — on a populated legacy table its NOT NULL-without-default ALTER
  // is rejected (try/catch swallows it) and the rebuild backfills it anyway; on a
  // fresh/already-migrated table it is already present and skipped. Per-stmt
  // try/catch: a NOT NULL-without-default column can't be added to a populated
  // legacy table (SQLite rule) — swallow and leave as-is (prior behaviour).
  for (const t of ordered) {
    const tableName = getTableConfig(t).name;
    const existing = new Set(
      (sqlite.query(`PRAGMA table_info(${tableName})`).all() as { name: string }[]).map((r) => r.name)
    );
    for (const stmt of generateMissingColumnAlters(t, existing)) {
      try { sqlite.exec(stmt); } catch { /* legacy column that can't be auto-added — leave as-is */ }
    }
  }

  // ── Idempotent legacy migration: normalize free-text `store` → `store_id` FK ──
  // Runs ONLY for OLD dbs that still carry the `store` text column. Fresh dbs get
  // the new schema from the generated CREATE statements above and skip this entirely.
  // Rebuild order: scrape_jobs FIRST (parent), then discount_items (child) — so
  // discount_items' FK + the orphan-drop INNER-lookup see the rebuilt scrape_jobs.
  // The whole rebuild MUST run with foreign_keys OFF (already OFF at this point).
  // (All tables — incl. savings_log/recipes/shopping_list_items/offer_history —
  // were already created up front by the generator loop; the rebuild only touches
  // scrape_jobs + discount_items.)
  migrateStoreToStoreId(sqlite);

  // Indexes for hot query paths (idempotent).
  sqlite.exec("CREATE INDEX IF NOT EXISTS idx_discount_items_valid_until ON discount_items(valid_until)");
  sqlite.exec("CREATE INDEX IF NOT EXISTS idx_discount_items_taxonomy_category ON discount_items(taxonomy_category)");
  sqlite.exec("CREATE INDEX IF NOT EXISTS idx_discount_items_store_id ON discount_items(store_id)");
  sqlite.exec("CREATE INDEX IF NOT EXISTS idx_discount_items_scrape_job_id ON discount_items(scrape_job_id)");
  sqlite.exec("CREATE INDEX IF NOT EXISTS idx_scrape_jobs_store_status_completed ON scrape_jobs(store_id, status, completed_at)");
  sqlite.exec("CREATE INDEX IF NOT EXISTS idx_shopping_list_items_week_start ON shopping_list_items(week_start)");
  sqlite.exec("CREATE INDEX IF NOT EXISTS idx_savings_log_week_start ON savings_log(week_start)");
  sqlite.exec("CREATE INDEX IF NOT EXISTS idx_offer_history_store_id ON offer_history(store_id)");
  sqlite.exec("CREATE INDEX IF NOT EXISTS idx_offer_history_item_id ON offer_history(item_id)");

  // Turn FK enforcement ON for normal operation (all rebuilds are done).
  sqlite.exec("PRAGMA foreign_keys=ON");

  // Write-read-delete probe on scrape_jobs to verify R/W access. store_id must
  // reference an existing store (FK is enforced now) — use a seeded canonical row.
  const probeStore = sqlite
    .prepare("SELECT id FROM stores LIMIT 1")
    .get() as { id: number } | null;
  if (!probeStore) {
    throw new Error("DB startup probe failed: no seeded store row for probe FK");
  }
  const insert = sqlite.prepare(
    "INSERT INTO scrape_jobs (id, store_id, status, started_at, item_count) VALUES (?, ?, ?, ?, ?)"
  );
  insert.run(PROBE_ID, probeStore.id, "running", Date.now(), 0);

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

/**
 * Idempotent legacy rebuild of scrape_jobs + discount_items to replace the
 * free-text `store` column with a `store_id` FK to stores(id). No-op for fresh
 * dbs (no `store` column). MUST be called with foreign_keys OFF.
 */
function migrateStoreToStoreId(sqlite: Database): void {
  const now = Date.now();

  const rebuildScrapeJobs = (): void => {
    const cols = (sqlite.query("PRAGMA table_info(scrape_jobs)").all() as { name: string }[]).map(
      (c) => c.name
    );
    if (!cols.includes("store")) return; // already migrated / fresh schema

    // Ensure any stray store names present in the legacy data exist in stores.
    sqlite.exec(
      `INSERT OR IGNORE INTO stores (name, slug, created_at)
       SELECT DISTINCT store, lower(replace(store, ' ', '-')), ${now}
       FROM scrape_jobs WHERE store IS NOT NULL AND store NOT IN (SELECT name FROM stores)`
    );

    sqlite.exec(`
      CREATE TABLE scrape_jobs_new (
        id TEXT PRIMARY KEY,
        store_id INTEGER NOT NULL REFERENCES stores(id),
        status TEXT NOT NULL,
        started_at INTEGER NOT NULL,
        completed_at INTEGER,
        item_count INTEGER NOT NULL DEFAULT 0,
        error_message TEXT
      )
    `);

    sqlite.exec(`
      INSERT INTO scrape_jobs_new (id, store_id, status, started_at, completed_at, item_count, error_message)
      SELECT j.id, (SELECT id FROM stores WHERE name = j.store), j.status,
             j.started_at, j.completed_at, j.item_count, j.error_message
      FROM scrape_jobs j WHERE j.store IS NOT NULL
    `);

    sqlite.exec("DROP TABLE scrape_jobs");
    sqlite.exec("ALTER TABLE scrape_jobs_new RENAME TO scrape_jobs");
  };

  const rebuildDiscountItems = (): void => {
    const cols = (sqlite.query("PRAGMA table_info(discount_items)").all() as { name: string }[]).map(
      (c) => c.name
    );
    if (!cols.includes("store")) return; // already migrated / fresh schema

    sqlite.exec(
      `INSERT OR IGNORE INTO stores (name, slug, created_at)
       SELECT DISTINCT store, lower(replace(store, ' ', '-')), ${now}
       FROM discount_items WHERE store IS NOT NULL AND store NOT IN (SELECT name FROM stores)`
    );

    sqlite.exec(`
      CREATE TABLE discount_items_new (
        id TEXT PRIMARY KEY,
        store_id INTEGER NOT NULL REFERENCES stores(id),
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
    `);

    // Backfill store_id; drop orphan rows whose scrape_job_id has no matching
    // (already-rebuilt) scrape_jobs row.
    const beforeCount = (sqlite.query("SELECT COUNT(*) AS n FROM discount_items").get() as { n: number }).n;
    sqlite.exec(`
      INSERT INTO discount_items_new
        (id, store_id, name, category, regular_price, sale_price, valid_until,
         dietary_tags, tags, taxonomy_category, source_url, image_url, brand, description,
         scrape_job_id, created_at)
      SELECT d.id, (SELECT id FROM stores WHERE name = d.store), d.name, d.category,
             d.regular_price, d.sale_price, d.valid_until, d.dietary_tags, d.tags,
             d.taxonomy_category, d.source_url, d.image_url, d.brand, d.description,
             d.scrape_job_id, d.created_at
      FROM discount_items d
      WHERE d.store IS NOT NULL AND d.scrape_job_id IN (SELECT id FROM scrape_jobs)
    `);
    const afterCount = (sqlite.query("SELECT COUNT(*) AS n FROM discount_items_new").get() as { n: number }).n;
    const dropped = beforeCount - afterCount;
    if (dropped > 0) {
      console.warn(`db migration: dropped ${dropped} orphan discount_items row(s) with no matching scrape_job`);
    }

    sqlite.exec("DROP TABLE discount_items");
    sqlite.exec("ALTER TABLE discount_items_new RENAME TO discount_items");
  };

  rebuildScrapeJobs();
  rebuildDiscountItems();

  // Fail loud if any FK is left dangling by the rebuild.
  const violations = sqlite.query("PRAGMA foreign_key_check").all();
  if (violations.length > 0) {
    throw new Error(
      `db migration: foreign_key_check found ${violations.length} violation(s) after store_id rebuild`
    );
  }
}
