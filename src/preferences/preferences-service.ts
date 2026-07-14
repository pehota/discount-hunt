/**
 * PreferencesService — thin CRUD wrapper for the Preferences bounded context.
 *
 * Generic subdomain: no domain logic. Delegates to UserPreferencesRepository.
 */

import type { UserPreferences } from "../shared/types.ts";
import type { UserPreferencesRepository } from "./ports/preferences-repository.ts";

export class PreferencesService {
  constructor(private readonly repository: UserPreferencesRepository) {}

  getPreferences(): UserPreferences {
    return this.repository.get();
  }

  updatePreferences(prefs: UserPreferences): void {
    this.repository.upsert(prefs);
  }
}
