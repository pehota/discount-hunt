# TECH-06 — archive expired plans (linked Technical Task, delivered inside S01 persistence).
# On week-rollover / replace, expired saved plans are ARCHIVED (not deleted), mirroring
# offer_history; the double-count guard is unaffected; the current-week view is unchanged.

Feature: Archive expired plans for bounded storage and provenance

  Background:
    Given the application is running against a fresh database

  @skip @driving_port @tech-mpe-06 @real_io @contract-shape:bounded-change
  Scenario: Replacing a saved plan archives the previous plan rather than deleting it
    Given a plan is already saved for a previous week
    When a new plan is saved for the current week
    Then the previous week's plan is preserved in the plan archive
    And the current-week view shows only the current plan

  @skip @driving_port @tech-mpe-06 @real_io @contract-shape:unbounded-preservation
  Scenario: Archiving a plan does not disturb the savings double-count guard
    Given a saved plan whose savings are recorded once for the week
    When the plan is replaced and the previous plan is archived
    Then the savings tracker still shows exactly one record for that week
