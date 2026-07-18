# S02 — list-source (US-MPE-02, D2 contextual source). Trigger LOCATION determines the source:
# generating from /list uses the list's items; empty list -> explanatory empty state.

Feature: Generate a plan from the shopping list

  Background:
    Given the application is running against a fresh database

  @skip @driving_port @us-mpe-02 @real_io @contract-shape:bounded-change
  Scenario: Generating from the shopping list uses the list's items as the source
    Given Dimitar's shopping list contains Rote Linsen, Campari Tomaten and Basmati Reis
    When he generates a meal plan from the list
    Then the draft plan is built from the list's items
    And it is not built from the feed selection

  @skip @driving_port @us-mpe-02 @real_io @contract-shape:bounded-change
  Scenario: Generating from an empty list is explained, not fabricated
    Given Dimitar's shopping list is empty
    When he generates a meal plan from the list
    Then he sees "Your list is empty — add items first"
    And no plan is generated
