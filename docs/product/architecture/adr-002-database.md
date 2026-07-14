# ADR-002: Database and Recipe Cache

**Status**: Accepted
**Date**: 2026-07-13
**Deciders**: Titan (nw-system-designer)
**Supersedes**: —
**Superseded by**: —

---

## Context

discount-hunt requires persistent storage for 6 entity types:

| Table | Rows/year | Avg row size | Annual size |
|-------|-----------|--------------|-------------|
| `discount_items` | ~8,060 (155/week × 52) | ~300 bytes | ~2.4 MB |
| `recipes` | ~260 (5/week × 52) | ~5 KB (cached JSON-LD) | ~1.3 MB |
| `meal_plans` | ~52 | ~2 KB | ~104 KB |
| `savings_log` | ~52 | ~200 bytes | ~10 KB |
| `scrape_jobs` | ~3 rows total (one per store) | ~200 bytes | negligible |
| `user_settings` | 1 row | ~200 bytes | negligible |

**Total annual storage: < 5 MB.**

**Write profile:**
- Scraper: batch INSERT ~155 rows, once/week, ~30s window
- Web: INSERT one `meal_plan` row + one `savings_log` row on plan generation
- Recipe fetcher: INSERT one `recipe` row per cache miss (~5/week)

**Read profile:**
- One human, interactive queries, < 1 QPS
- Most complex query: JOIN `discount_items` × `user_settings` for meal plan generation (at most ~155 rows scanned)

**Recipe cache requirements:**
- 7-day TTL from `cached_at`
- Cache key: ingredient name (normalised)
- Miss action: Brave Search → Chefkoch fetch → INSERT
- Hit action: SELECT WHERE `cached_at > NOW() - INTERVAL 7 DAY`
- Volume: ~5 writes/week, ~5 reads/week

---

## Decision

**SQLite** (WAL mode) for all persistent data including recipe cache.

No secondary data store. No Redis. No external daemon.

**Schema location:** `discount-hunt.db` in the working directory (or configurable via `DATABASE_PATH` env var).

**Required pragmas on every connection open:**

```sql
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;
```

**Recipe cache:** `recipes` table with `cached_at DATETIME` column. Cache invalidation is a SELECT predicate, not a TTL mechanism in a cache store:

```sql
SELECT * FROM recipes
WHERE ingredient_key = ?
  AND cached_at > datetime('now', '-7 days');
```

**Startup probe:**

```typescript
// Verify WAL mode is active and DB is writable
const row = db.query("PRAGMA journal_mode").get();
if (row.journal_mode !== "wal") {
  throw new Error("health.startup.refused: SQLite WAL mode not active");
}
db.run("CREATE TABLE IF NOT EXISTS _probe (id INTEGER PRIMARY KEY)");
db.run("INSERT INTO _probe VALUES (1)");
db.run("DELETE FROM _probe WHERE id = 1");
```

---

## Consequences

**Positive:**

- Zero additional processes. No `pg_ctl start`, no Redis daemon, no connection pool config.
- File-portable: `cp discount-hunt.db /backup/` is a complete database backup.
- SQLite handles this workload natively: the SQLite FAQ states it handles applications with fewer than 100K hits/day trivially. This app has ~10 reads/day.
- WAL mode eliminates read/write contention: scraper (writer) and web server (reader) can operate simultaneously without blocking.
- Recipe cache TTL logic is a SQL predicate — no cache invalidation protocol, no eviction policy configuration, no TTL key management.
- `db.backup()` in Bun/better-sqlite3 for point-in-time snapshots with zero downtime.

**Negative / trade-offs:**

- Not suitable if the app later becomes multi-machine (SQLite is single-host). If discount-hunt ever moves to a remote server accessed by multiple devices, this ADR must be revisited. At that point, PostgreSQL is the natural upgrade path — schema is compatible, migration is `pg_dump`-adjacent.
- No built-in query performance insights (no `EXPLAIN ANALYZE` UI). For a 155-row join this is not a real constraint, but noted.
- WAL mode on Docker overlayfs may not persist fsync correctly. If deployed in Docker, `docker volume` (not bind mount to overlayfs path) must be used for `discount-hunt.db`.

---

## Alternatives Considered

### Alternative 1 — PostgreSQL

Full relational database with daemon, TCP connections, roles, and WAL replication.

**Rejected because:**
- Adds a required background daemon (`postgres`) with process lifecycle management.
- Connection pooling config required even for 1 connection.
- Schema migrations require `pg_migrate` or similar tooling.
- 4 MB of data does not approach any PostgreSQL scaling benefit.
- Upgrade path from SQLite remains available if/when multi-device access is needed.

### Alternative 2 — PostgreSQL + Redis (recipe cache)

PostgreSQL for primary data, Redis for recipe cache (TTL keys).

**Rejected because:**
- Redis is a second data store and a second daemon for 5 cache writes per week.
- 7-day TTL is a `WHERE cached_at > datetime('now', '-7 days')` predicate in SQL — zero reason to introduce a key-value TTL store.
- Two services to start, monitor, and backup for no measurable performance difference at this scale.

### Alternative 3 — SQLite + File-Based Recipe Cache

SQLite for all tables except recipes; recipe JSON-LD cached as individual `.json` files on disk.

**Rejected because:**
- File cache complicates backup (two things to back up: DB file + directory).
- No transactional guarantee between file write and a reference row (e.g., updating `meal_plans` to reference a recipe that failed to write to disk).
- SQLite already handles this correctly; files add complexity without benefit.

### Alternative 4 — Turso (libSQL, remote SQLite)

Cloud-hosted SQLite-compatible DB.

**Rejected because:**
- This is a localhost-first personal app (D9). Remote cloud storage for personal grocery data adds latency, cost, and a dependency on external service availability — none of which are acceptable trade-offs for a tool that must work offline.
