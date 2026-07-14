/**
 * SQLiteUserPreferencesRepository — secondary adapter for UserPreferencesRepository.
 *
 * Table: user_settings (see src/shared/schema.ts)
 * Single-row singleton: fixed PK user_id='dimitar' (D9) + INSERT ... ON CONFLICT
 * DO UPDATE, so the table structurally cannot hold more than one settings row.
 *
 * Substrate probe (Principle 13): inherits the shared WAL write-read-delete startup
 * probe in db.ts — no new probe here (D35 wire→probe→use covers the shared client).
 */

import { sql } from "drizzle-orm";
import type { DbClient } from "../../shared/db.ts";
import type { DietaryRestriction, UserPreferences } from "../../shared/types.ts";
import type { UserPreferencesRepository } from "../ports/preferences-repository.ts";

const SINGLETON_USER_ID = "dimitar";

export class SQLiteUserPreferencesRepository implements UserPreferencesRepository {
  constructor(private readonly db: DbClient) {}

  get(): UserPreferences {
    // drizzle-orm/bun-sqlite .get() returns a positional value array (or undefined).
    const row = this.db.get<[string]>(
      sql`SELECT dietary_restriction FROM user_settings WHERE user_id = ${SINGLETON_USER_ID}`,
    );
    if (!row) return { dietaryRestriction: "none" };
    return { dietaryRestriction: row[0] as DietaryRestriction };
  }

  upsert(prefs: UserPreferences): void {
    this.db.run(sql`
      INSERT INTO user_settings (user_id, dietary_restriction, updated_at)
      VALUES (${SINGLETON_USER_ID}, ${prefs.dietaryRestriction}, ${Date.now()})
      ON CONFLICT(user_id) DO UPDATE SET
        dietary_restriction = excluded.dietary_restriction,
        updated_at = excluded.updated_at
    `);
  }
}
