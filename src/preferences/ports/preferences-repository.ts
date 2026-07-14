/**
 * UserPreferencesRepository — driven port for the Preferences bounded context.
 *
 * A genuine read+write CRUD port (settings page writes; plan-service and
 * discount-handler read). Single-row singleton: get() returns the honest default
 * when unset (never null), so consumers never branch on "is there a row".
 */

import type { UserPreferences } from "../../shared/types.ts";

export interface UserPreferencesRepository {
  /**
   * Single-row read; returns honest defaults if unset (never null):
   * { dietaryRestriction: 'none', budgetCapCents: null }.
   */
  get(): UserPreferences;
  /** Idempotent single-row write (fixed-PK upsert-on-conflict). */
  upsert(prefs: UserPreferences): void;
}
