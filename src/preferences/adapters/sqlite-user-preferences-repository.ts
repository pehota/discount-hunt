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
import type {
  CookingTime,
  DietaryRestriction,
  MealSlot,
  UserPreferences,
} from "../../shared/types.ts";
import type { UserPreferencesRepository } from "../ports/preferences-repository.ts";

const SINGLETON_USER_ID = "dimitar";

// Documented recipe-param defaults (roadmap 12-01 criteria).
const DEFAULT_KID_FRIENDLY = false;
const DEFAULT_HOUSEHOLD_SIZE = 2;
const DEFAULT_COOKING_TIME: CookingTime = "any";
const DEFAULT_MEAL_TYPES: MealSlot[] = ["lunch", "dinner"];

const VALID_MEAL_SLOTS: readonly MealSlot[] = ["lunch", "dinner"];

/** Parses the meal_types JSON column, keeping only valid slots; falls back to the default. */
function parseMealTypes(raw: string | null): MealSlot[] {
  if (!raw) return [...DEFAULT_MEAL_TYPES];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [...DEFAULT_MEAL_TYPES];
    const slots = parsed.filter(
      (value): value is MealSlot => VALID_MEAL_SLOTS.includes(value as MealSlot),
    );
    return slots.length > 0 ? slots : [...DEFAULT_MEAL_TYPES];
  } catch {
    return [...DEFAULT_MEAL_TYPES];
  }
}

export class SQLiteUserPreferencesRepository implements UserPreferencesRepository {
  constructor(private readonly db: DbClient) {}

  get(): UserPreferences {
    // drizzle-orm/bun-sqlite .get() returns a positional value array (or undefined).
    // Tuple order MUST match the SELECT list below, column-for-column.
    const row = this.db.get<
      [string, number | null, number, number, string, string]
    >(
      sql`SELECT dietary_restriction, budget_cap_cents, kid_friendly, household_size, cooking_time, meal_types FROM user_settings WHERE user_id = ${SINGLETON_USER_ID}`,
    );
    if (!row) {
      return {
        dietaryRestriction: "none",
        budgetCapCents: null,
        kidFriendly: DEFAULT_KID_FRIENDLY,
        householdSize: DEFAULT_HOUSEHOLD_SIZE,
        cookingTime: DEFAULT_COOKING_TIME,
        mealTypes: [...DEFAULT_MEAL_TYPES],
      };
    }
    return {
      dietaryRestriction: row[0] as DietaryRestriction,
      budgetCapCents: row[1],
      kidFriendly: row[2] === 1,
      householdSize: row[3],
      cookingTime: row[4] as CookingTime,
      mealTypes: parseMealTypes(row[5]),
    };
  }

  upsert(prefs: UserPreferences): void {
    // undefined would throw at the bun:sqlite binding layer — coalesce to defaults.
    const budgetCapCents = prefs.budgetCapCents ?? null;
    const kidFriendly = (prefs.kidFriendly ?? DEFAULT_KID_FRIENDLY) ? 1 : 0;
    const householdSize = prefs.householdSize ?? DEFAULT_HOUSEHOLD_SIZE;
    const cookingTime = prefs.cookingTime ?? DEFAULT_COOKING_TIME;
    const mealTypes = JSON.stringify(prefs.mealTypes ?? DEFAULT_MEAL_TYPES);
    this.db.run(sql`
      INSERT INTO user_settings (user_id, dietary_restriction, budget_cap_cents, kid_friendly, household_size, cooking_time, meal_types, updated_at)
      VALUES (${SINGLETON_USER_ID}, ${prefs.dietaryRestriction}, ${budgetCapCents}, ${kidFriendly}, ${householdSize}, ${cookingTime}, ${mealTypes}, ${Date.now()})
      ON CONFLICT(user_id) DO UPDATE SET
        dietary_restriction = excluded.dietary_restriction,
        budget_cap_cents = excluded.budget_cap_cents,
        kid_friendly = excluded.kid_friendly,
        household_size = excluded.household_size,
        cooking_time = excluded.cooking_time,
        meal_types = excluded.meal_types,
        updated_at = excluded.updated_at
    `);
  }
}
