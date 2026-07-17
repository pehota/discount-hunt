/**
 * Runtime DDL generator — single source of truth for table creation AND for the
 * legacy column-heal.
 *
 * Emits `CREATE TABLE IF NOT EXISTS` from a Drizzle table definition via
 * getTableConfig, so schema.ts is the ONLY place table structure is declared
 * (no hand-synced raw CREATE_* strings). IF NOT EXISTS makes it a no-op on an
 * existing populated DB; fresh DBs get the full current schema in one shot.
 *
 * Also drives the schema-driven legacy column-heal (generateMissingColumnAlters):
 * ALTER statements to add any schema.ts column missing from an existing table,
 * replacing the former hand-listed ALTERs in db.ts — no column name is spelled
 * out anywhere but schema.ts. The per-column clause is built ONCE (columnClause)
 * and reused by both CREATE and ALTER paths.
 *
 * Scope: covers exactly the constraints this project uses — single-column PK
 * (incl. AUTOINCREMENT and text-PK-with-default), NOT NULL, per-column UNIQUE,
 * text/integer defaults, and single-column inline foreign keys. It intentionally
 * does NOT handle composite PKs / composite FKs / table-level constraints
 * (none exist here). Add support here (with a test) if the schema ever needs it.
 */
import { getTableConfig, type SQLiteTable } from "drizzle-orm/sqlite-core";

type Cfg = ReturnType<typeof getTableConfig>;
type Col = Cfg["columns"][number];

/**
 * Builds the per-column SQL clause shared by CREATE and ALTER paths.
 *
 * forAlter drops the constraints SQLite forbids in `ALTER ADD COLUMN`:
 * PRIMARY KEY (+AUTOINCREMENT) and UNIQUE. Everything else (type, NOT NULL,
 * DEFAULT, REFERENCES) is identical in both modes.
 */
function columnClause(c: Col, cfg: Cfg, opts: { forAlter: boolean }): string {
  const parts: string[] = [c.name, c.getSQLType()];
  if (c.primary && !opts.forAlter) {
    parts.push("PRIMARY KEY");
    if ((c as { autoIncrement?: boolean }).autoIncrement) parts.push("AUTOINCREMENT");
  }
  if (c.notNull && !c.primary) parts.push("NOT NULL");
  if (!opts.forAlter && (c as { isUnique?: boolean }).isUnique) parts.push("UNIQUE");
  if (c.hasDefault && c.default !== undefined) {
    const d = c.default;
    parts.push(`DEFAULT ${typeof d === "string" ? `'${d.replace(/'/g, "''")}'` : String(d)}`);
  }
  const fk = cfg.foreignKeys.find((f) => f.reference().columns.some((x) => x.name === c.name));
  if (fk) {
    const r = fk.reference();
    const foreignColumn = r.foreignColumns[0];
    if (foreignColumn) {
      parts.push(`REFERENCES ${getTableConfig(r.foreignTable).name}(${foreignColumn.name})`);
    }
  }
  return parts.join(" ");
}

export function generateCreateTableSql(table: SQLiteTable): string {
  const cfg = getTableConfig(table);
  const cols = cfg.columns.map((c) => columnClause(c, cfg, { forAlter: false }));
  return `CREATE TABLE IF NOT EXISTS ${cfg.name} (\n  ${cols.join(",\n  ")}\n)`;
}

/**
 * ALTER statements to add any schema.ts column missing from an existing table
 * (schema-driven legacy heal — the SSOT replacement for hand-listed ALTERs).
 * Skips PK/UNIQUE columns (SQLite cannot ADD them) — those always exist from
 * table creation and are never healed. Caller wraps each exec in try/catch:
 * a NOT NULL-without-default column can't be added to a populated legacy table.
 */
export function generateMissingColumnAlters(table: SQLiteTable, existingColumns: ReadonlySet<string>): string[] {
  const cfg = getTableConfig(table);
  const stmts: string[] = [];
  for (const c of cfg.columns) {
    if (existingColumns.has(c.name)) continue;
    if (c.primary || (c as { isUnique?: boolean }).isUnique) continue;
    stmts.push(`ALTER TABLE ${cfg.name} ADD COLUMN ${columnClause(c, cfg, { forAlter: true })}`);
  }
  return stmts;
}
