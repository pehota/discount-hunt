/**
 * meal-plan-domain — typed domain vocabulary for the meal-plan-engine acceptance suite.
 *
 * Mandate-12 (SSOT via types): every domain noun the .feature scenarios speak is expressed
 * once here as a typed const or enum, so the paired *.test.ts files reference these instead of
 * inlining literals. This is the TypeScript-idiom equivalent of the Python pilot's
 * `domain_types.py` (the pytest-bdd `parsers.parse(...enum...)` decorator model does not map to
 * bun:test describe/test blocks — documented N/A-by-idiom in the feature-delta CM-I evidence).
 *
 * Real Munich data per DISCUSS (Rote Linsen €1.19, Mozzarella €0.69, Campari Tomaten €1.29,
 * Vollmilch €1.09). Prices are in CENTS (the app's numeric SSOT: regularPrice/salePrice cents).
 */

export const STORE = "Aldi Süd";

/** Dietary restriction domain enum — the three shipped values (settings-handler). */
export const DietaryRestriction = {
  None: "none",
  Vegetarian: "vegetarian",
  Vegan: "vegan",
} as const;
export type DietaryRestriction =
  (typeof DietaryRestriction)[keyof typeof DietaryRestriction];

/** A discounted product as it enters a basket (cents; regular > sale invariant per D22). */
export interface DiscountedProduct {
  readonly id: string;
  readonly name: string;
  readonly regularPriceCents: number;
  readonly salePriceCents: number;
  readonly dietaryTags: readonly string[];
}

/** Real Munich vegetarian deals — the happy-path basket the US-MPE-01 examples use. */
export const ROTE_LINSEN: DiscountedProduct = {
  id: "mpe-rote-linsen",
  name: "Rote Linsen",
  regularPriceCents: 199,
  salePriceCents: 119,
  dietaryTags: ["vegetarian", "vegan"],
};

export const CAMPARI_TOMATEN: DiscountedProduct = {
  id: "mpe-campari-tomaten",
  name: "Campari Tomaten",
  regularPriceCents: 199,
  salePriceCents: 129,
  dietaryTags: ["vegetarian", "vegan"],
};

export const MOZZARELLA: DiscountedProduct = {
  id: "mpe-mozzarella",
  name: "Mozzarella",
  regularPriceCents: 99,
  salePriceCents: 69,
  dietaryTags: ["vegetarian"],
};

export const BASMATI_REIS: DiscountedProduct = {
  id: "mpe-basmati-reis",
  name: "Basmati Reis",
  regularPriceCents: 249,
  salePriceCents: 149,
  dietaryTags: ["vegetarian", "vegan"],
};

/** A meat deal — must never surface in a vegetarian plan (JOB-003 hard gate). */
export const RINDERHACK: DiscountedProduct = {
  id: "mpe-rinderhack",
  name: "Rinderhackfleisch",
  regularPriceCents: 499,
  salePriceCents: 349,
  dietaryTags: ["contains-meat"],
};

/** The canonical vegetarian happy-path basket (US-MPE-01 domain example 1). */
export const HAPPY_VEG_BASKET: readonly DiscountedProduct[] = [
  ROTE_LINSEN,
  CAMPARI_TOMATEN,
  MOZZARELLA,
];

/**
 * Non-vegetarian keyword families the DietaryVerifier gold corpus must REJECT.
 * Source = Chefkoch (German, ADR-008 reverted): the German families are what matter; the English
 * families are kept as harmless extra coverage (no need to trim). The RUN-4 known lies (Schinken,
 * Kalbsbrät) are included. Consumed by the collocated pure-unit gold test.
 */
export const NON_VEG_GOLD_REJECT = {
  de: [
    "Schinken",
    "Speck",
    "Wurst",
    "Salami",
    "Hackfleisch",
    "Rind",
    "Kalb",
    "Kalbsbrät",
    "Gulasch",
    "Hähnchen",
    "Huhn",
    "Pute",
    "Geflügel",
    "Fisch",
    "Lachs",
    "Thunfisch",
    "Hering",
    "Garnele",
    "Gelatine",
  ],
  en: [
    "ham",
    "bacon",
    "pork",
    "sausage",
    "salami",
    "beef",
    "veal",
    "mince",
    "ground meat",
    "chicken",
    "turkey",
    "poultry",
    "fish",
    "salmon",
    "tuna",
    "shrimp",
    "prawn",
    "gelatin",
  ],
} as const;

/**
 * Word-boundary NON-matches — vegetarian ingredients that must NOT be flagged
 * (the SPIKE substring over-matcher bug: `reis` ⊄ `preiselbeeren`, `hack` ⊄ `gehackt`,
 * `ham` ⊄ `chamomile`, `rind` ⊄ `Spinatrinde`).
 */
export const WORD_BOUNDARY_SAFE = [
  "Preiselbeeren",
  "gehackte Petersilie",
  "chamomile tea",
  "Basmati Reis", // "Reis" is a food word but not a non-veg keyword; safe
  "Grapefruit",
] as const;

/** Contract-shape tags (Mandate 14) — machine-parseable, one per scenario. */
export const ContractShape = {
  PureFunction: "pure-function",
  BoundedChange: "bounded-change",
  UnboundedPreservation: "unbounded-preservation",
} as const;
export type ContractShape =
  (typeof ContractShape)[keyof typeof ContractShape];
