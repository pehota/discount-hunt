# S03 — cost objective (US-MPE-03, D7). Minimise total EUR preferring discounts; no over-buy;
# deduped savings == shipped tracker for the same rows; double-count guard survives; footer shows
# spend vs all-regular baseline. @kpi links to KPI-1/KPI-2/KPI-3.

Feature: Build the plan that makes the weekly shop cheapest

  Background:
    Given the application is running against a fresh database

  @skip @driving_port @us-mpe-03 @real_io @contract-shape:bounded-change
  Scenario: The plan minimises total spend, preferring discounts where cheapest
    Given two candidate recipes can fill the same slot using different discounted products
    When the plan is generated
    Then the recipe leading to the lower total weekly spend is chosen

  @skip @driving_port @us-mpe-03 @real_io @contract-shape:bounded-change
  Scenario: The plan does not over-buy deals to inflate the discount count
    Given more discounted products are selected than the week's meals require
    When the plan is generated
    Then the plan uses only the products needed to cover the meals

  @skip @driving_port @us-mpe-03 @kpi @real_io @contract-shape:bounded-change
  Scenario: Spend and savings count a shared product only once and match the savings tracker
    Given a discounted product is used by two meals in the plan
    When the plan is saved
    Then that product's price is counted once in the plan's spend and saving
    And the plan's saving equals the savings tracker figure for the same products

  @skip @driving_port @us-mpe-03 @kpi @real_io @contract-shape:bounded-change
  Scenario: The plan footer shows spend against an all-regular-price baseline
    Given a generated plan using discounted products
    When Dimitar views the plan
    Then the plan shows its total spend and the saving versus regular prices
