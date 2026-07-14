# Walking Skeleton — discount-hunt S01
#
# Validates the full user journey: the weekly catalogue is imported,
# discounted items appear with their original and sale prices,
# generating a meal plan produces a confirmed saving estimate,
# and the savings tracker shows the same figure.
#
# Uses a test double for the catalogue source to avoid live network I/O.
# One scenario enabled at a time; Scenario 2 is @skip until Scenario 1 passes.

Feature: Weekly discount meal planning — walking skeleton

  Background:
    Given the application starts fresh with no prior week data
    And the Aldi catalogue fake is configured

  @walking_skeleton @s01 @real_io @contract-shape:bounded-change
  Scenario: Shopper sees discounted items, generates a meal plan, and confirms savings match the estimate
    Given the Aldi catalogue has 3 discounted items with both regular price and sale price
    When the scraper runs and completes successfully
    Then the discount feed shows 3 discount items each with a "was" price and a sale price
    When the shopper generates a meal plan
    Then the meal plan shows an estimated weekly saving
    When the shopper views the savings tracker
    Then the saved amount in the savings tracker matches the estimated saving from the meal plan
    And no other savings records exist

  @walking_skeleton @s01 @real_io @contract-shape:bounded-change @skip
  Scenario: Shopper sees an empty discount feed when catalogue contains no items with both prices
    Given the Aldi catalogue has items but none have both a regular price and a sale price
    When the scraper runs and completes successfully
    Then the discount feed shows "No discounts available this week"
    And no discounted products appear in the feed
