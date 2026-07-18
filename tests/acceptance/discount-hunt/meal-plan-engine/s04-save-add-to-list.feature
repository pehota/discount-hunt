# S04 — save->list (US-MPE-04, D4). Save prompts add-plan-discounts-to-list; accept adds via the
# shipped POST /list/add; decline leaves the list unchanged; already-on-list is not duplicated.

Feature: On save, offer to add the plan's deals to the shopping list

  Background:
    Given the application is running against a fresh database
    And this week's discounts include Rote Linsen, Campari Tomaten and Mozzarella

  @skip @driving_port @us-mpe-04 @real_io @contract-shape:bounded-change
  Scenario: Accepting the prompt adds the plan's deals to the shopping list
    Given Dimitar has saved a plan using Rote Linsen, Campari Tomaten and Mozzarella
    When he accepts the add-to-list prompt
    Then those three products appear on his shopping list
    And the list running total increases accordingly

  @skip @driving_port @us-mpe-04 @real_io @contract-shape:unbounded-preservation
  Scenario: Declining the prompt saves the plan and leaves the list unchanged
    Given Dimitar has saved a plan and the add-to-list prompt is shown
    When he declines
    Then the plan remains saved
    And the shopping list is unchanged

  @skip @driving_port @us-mpe-04 @real_io @contract-shape:bounded-change
  Scenario: A product already on the list is not duplicated when the prompt is accepted
    Given Campari Tomaten is already on Dimitar's list
    When he accepts the add-to-list prompt for a plan that also uses Campari Tomaten
    Then no duplicate row is created for Campari Tomaten
