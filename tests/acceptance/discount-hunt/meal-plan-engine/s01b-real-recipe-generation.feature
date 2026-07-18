# S01b — real-recipe generation (US-MPE-01 + SPIKE reshape). GATED on slice-00 GO.
# Each meal = a REAL recipe (title + source link) using >=1 discounted anchor; dietary-safe
# (JOB-003 hard gate, German-source blocklist); no-recipe -> explicit empty-with-reason, never fabricated.

Feature: Real-recipe generation from this week's deals

  Background:
    Given the application is running against a fresh database
    And this week's discounts include Rote Linsen, Campari Tomaten and Mozzarella

  @skip @driving_port @us-mpe-01 @real_io @contract-shape:bounded-change
  Scenario: Each drafted meal is a real recipe naming the discounted products it uses
    When Dimitar generates a draft from his selected deals
    Then each meal is a real recipe title linking to its source
    And each meal names the discounted product it uses
    And no meal is merely a raw discount-item name

  @skip @driving_port @us-mpe-01 @real_io @contract-shape:unbounded-preservation
  Scenario: A recipe with a hidden meat ingredient never surfaces to a vegetarian plan
    Given Dimitar's dietary restriction is vegetarian
    And the recipe source would return a recipe secretly listing Schinken
    When he generates a draft
    Then no drafted meal contains a meat or fish ingredient
    And a dietary guardrail violation is recorded for the rejected recipe

  @skip @driving_port @us-mpe-01 @real_io @contract-shape:bounded-change
  Scenario: When no real dietary-safe recipe can be built the draft explains itself
    Given the recipe source can find no dietary-safe recipe for the selection
    When Dimitar generates a draft
    Then the draft shows "Couldn't build meals from these — try a different selection"
    And no meal is fabricated
