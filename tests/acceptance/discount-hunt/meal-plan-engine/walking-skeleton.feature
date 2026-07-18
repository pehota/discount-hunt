# Walking Skeleton — meal-plan-engine (brownfield invariant rail)
#
# DISCUSS declared "Walking skeleton: None — brownfield" (feature-delta ~L219-222): the app already
# ships an end-to-end discount->plan->savings flow. DISTILL reconciles this by choosing ONE
# walking-skeleton scenario over the INVARIANT rail — behaviour that is green TODAY and that the
# meal-plan-engine feature MUST preserve (System Constraints "No regression"): generate a plan ->
# the plan shows a saving -> the savings tracker matches -> the plan's discounted items add to the
# shopping list via the shipped POST /list/add. This differs from the shipped S01 walking skeleton
# (tests/acceptance/discount-hunt/walking-skeleton.feature) by exercising the shopping-list leg —
# the JOB-004 loop the whole feature serves — so it is NOT a duplicate.
#
# It deliberately does NOT assert "each meal is a real recipe title" — that behaviour cannot be
# green before DELIVER (DISTILL writes no production code). All new-engine behaviour is @skip.

Feature: Meal-plan-engine invariant rail — generate, save, and shop from a plan

  Background:
    Given the application is running against a fresh database
    And this week's discounts include Rote Linsen, Campari Tomaten and Mozzarella

  @walking_skeleton @driving_port @real_io @contract-shape:bounded-change
  Scenario: Dimitar generates a plan, sees its saving, and adds its deals to his shopping list
    When he generates a meal plan from this week's discounts
    Then the meal plan shows an estimated weekly saving
    And the savings tracker shows the same saved amount as the plan estimate
    When he adds the plan's discounted products to his shopping list
    Then the shopping list contains Rote Linsen, Campari Tomaten and Mozzarella
    And the shopping list running total reflects those products' sale prices
