# S01a — draft lifecycle (US-MPE-01 ACs) — NOT gated on the SPIKE.
# Throwaway DRAFT (not persisted) + regenerate-WHOLE + Save (persists + prompts add-to-list) +
# Discard. The existing saved plan and savings_log are untouched until Save.
# Every scenario is @skip (one scenario = one DELIVER TDD cycle).

Feature: Meal-plan draft lifecycle — experiment before committing

  Background:
    Given the application is running against a fresh database
    And this week's discounts include Rote Linsen, Campari Tomaten and Mozzarella

  @skip @driving_port @us-mpe-01 @real_io @contract-shape:unbounded-preservation
  Scenario: Generating a draft does not save it — the existing saved plan is untouched
    Given a plan is already saved for this week
    When Dimitar generates a new draft and does not save it
    Then the saved plan for the week is unchanged
    And no savings record is written for the draft

  @skip @driving_port @us-mpe-01 @real_io @contract-shape:unbounded-preservation
  Scenario: Regenerate rebuilds the whole draft without persisting anything
    Given Dimitar is viewing a draft plan
    When he regenerates the draft
    Then a new draft is shown
    And nothing has been persisted to the saved plan or the savings tracker

  @skip @driving_port @us-mpe-01 @real_io @contract-shape:bounded-change
  Scenario: Saving a draft persists it and offers to add its deals to the shopping list
    Given Dimitar is viewing a draft plan
    When he saves the draft
    Then the draft is persisted as this week's saved plan
    And he is asked whether to add the plan's discounted items to his shopping list

  @skip @driving_port @us-mpe-01 @real_io @contract-shape:unbounded-preservation
  Scenario: Discarding a draft drops it and shows the last saved plan
    Given a plan is already saved for this week
    And Dimitar is viewing a newer unsaved draft
    When he discards the draft
    Then the draft is removed
    And the last saved plan is shown again
