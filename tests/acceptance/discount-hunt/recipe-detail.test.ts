/**
 * Acceptance Tests — SLICE-05: Recipe detail view (recipe integration)
 *
 * Source of truth: docs/feature/discount-hunt/design-slice-05-recipes.md
 *   §7 (RecipeHandler / view content), §8 (fallbacks), §9 (highlighting),
 *   §10 (plan titles → links), §11 (routing), §12 (behavior table B1–B12).
 * Wave: DISTILL. Authored against the DESIGNED behavior, not current code.
 *
 * ── NO NETWORK ──────────────────────────────────────────────────────────────
 * The live ChefkochRecipeSource must NEVER be reached by this suite. The seam is
 * the driven `RecipeSource` port (design §3). Tests inject a deterministic,
 * in-memory `FakeRecipeSource` into createServer. The Fake returns canned data
 * (or null) so every behavior is asserted through rendered HTML with zero I/O.
 *
 * ── INJECTION SIGNATURE ASSUMED (crafter contract) ──────────────────────────
 *   createServer({ port, dbPath, recipeSource? }: ServerConfig & { recipeSource?: RecipeSource })
 * Prod default = `new ChefkochRecipeSource()` when `recipeSource` is undefined.
 * Tests pass a FakeRecipeSource. The crafter MUST honor this param name and wire
 * it into `new RecipeService(recipeRepo, recipeSource ?? new ChefkochRecipeSource())`.
 * (bun transpiles without typechecking, so the extra `recipeSource` property on
 *  the config object is runtime-safe today and simply ignored until wired.)
 *
 * ── RecipeSource / FetchedRecipe SHAPE (design §3) ──────────────────────────
 *   interface RecipeSource { find(query: string): Promise<FetchedRecipe | null>; }
 *   type FetchedRecipe = { name: string; ingredients: string[]; steps: string[]; sourceUrl: string };
 * Declared structurally in-test (the port file does not exist yet — importing it
 * would be an ImportError → BROKEN, not RED). Duck-typed so the file loads.
 *
 * ── MARKERS CHOSEN (the crafter must render precisely these) ────────────────
 *   - meal_id format ............ `{day}-{slot}`  e.g. `1-lunch` (day 1 lunch = first seeded item)
 *   - on-sale badge ............. attribute `data-on-sale` on the matching ingredient row,
 *                                 text includes the store name + formatted sale price `€X.XX`
 *   - original recipe link ...... <a ... target="_blank" rel="noopener" href="{sourceUrl}"> with
 *                                 visible text containing "Open original recipe"
 *   - back link ................. <a href="/plan"> with text containing "Back to meal plan"
 *   - dead-source notice ........ class="staleness-warning" (reuses layout.ts) + word "unavailable"
 *   - no-match search link ...... href="https://www.chefkoch.de/suche.php?suche=<encodeURIComponent(meal.name)>"
 *                                 opened target="_blank" rel="noopener"
 *   - plan meal link ............ <a href="/plan/{day}-{slot}"> around the meal name on GET /plan
 *
 * ── RED discipline ──────────────────────────────────────────────────────────
 *   - Imports are limited to PROVEN symbols (createDb, discountItems, scrapeJobs,
 *     createServer). The `recipes` table is created in-test via raw
 *     `CREATE TABLE IF NOT EXISTS` (design §4 has not added it to schema.ts yet),
 *     so seeding never throws → assertions are reached → failures are RED.
 *   - All expect() live in test bodies. beforeAll setup fetches carry no expect();
 *     a 404 from the unbuilt /plan/{meal_id} route resolves (does not throw).
 *   - A non-matching ingredient control (anti-Fixture-Theater): the highlight test
 *     asserts the non-matching ingredient carries NO badge, so the test cannot pass
 *     by blindly badging every row.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { createDb } from "../../../src/shared/db.ts";
import { scrapeJobs, discountItems } from "../../../src/shared/schema.ts";
import { buildRecipeQuery, type RecipeQueryPreferences } from "../../../src/recipe/recipe-query.ts";
import type { MealSlot } from "../../../src/shared/types.ts";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Database } from "bun:sqlite";

// ─── Composed-contract keying (12-04) ─────────────────────────────────────────
// Once the RecipeHandler passes the 3-arg (name, slot, prefs) form, RecipeService
// composes the query via buildRecipeQuery. A fresh test DB yields these prefs, so
// the composed query_key MUST be computed from them (not the bare meal name).
const DEFAULT_PREFS: RecipeQueryPreferences = {
  dietaryRestriction: "none",
  kidFriendly: false,
  householdSize: 2,
  cookingTime: "any",
};

/** The composed cache/source key the service produces for a meal name + slot under default prefs. */
function composedQueryKey(mealName: string, slot: MealSlot): string {
  return buildRecipeQuery(mealName, slot, DEFAULT_PREFS).toLowerCase().trim();
}

// ─── Structural port shape (declared in-test; no import of a not-yet-existent file) ──

type FetchedRecipe = {
  name: string;
  ingredients: string[];
  steps: string[];
  sourceUrl: string;
};

/**
 * Deterministic, in-memory RecipeSource. NO network, NO I/O.
 * Constructed with a Map<queryKey, FetchedRecipe | null>. `find` normalizes the
 * incoming query the same way the service does (lowercase + trim) and returns the
 * configured result, or null (no-match / dead-source path). `calls` records every
 * query for spy-style assertions if a later step needs them.
 */
class FakeRecipeSource {
  public readonly calls: string[] = [];
  constructor(private readonly canned: Map<string, FetchedRecipe | null>) {}
  async find(query: string): Promise<FetchedRecipe | null> {
    this.calls.push(query);
    // 12-04: the service now composes a query (meal name + slot + params), so the
    // incoming query CONTAINS the canned meal-name key rather than equalling it.
    // Match by substring — the composed query always contains the bare meal name.
    const normalized = query.toLowerCase().trim();
    for (const [cannedKey, recipe] of this.canned) {
      if (normalized.includes(cannedKey)) {
        return recipe;
      }
    }
    return null;
  }
}

// ─── Domain vocabulary (distinctive, greppable) ───────────────────────────────

const STORE = "Aldi Süd";

// First seeded discount item → becomes meal `1-lunch` (day 1 lunch = items[0]).
// Its name is both the meal name AND the recipe query key.
const MEAL_ITEM = "Rote Linsen";
const MEAL_ITEM_SALE_CENTS = 129; // €1.29 via formatEuros (€X.XX, dot separator)
const MEAL_ITEM_SALE_EUROS = "€1.29";

// A second item so day-1-dinner is also populated (proves cycling / non-empty plan).
const OTHER_ITEM = "Zucchini";

/** ISO date N days from now (validUntil must be >= current Monday to survive getByWeek). */
function daysFromNow(n: number): string {
  return new Date(Date.now() + n * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/**
 * Seeds a scrape_jobs row (activates the per-store path) + discount items valid
 * this week. `MEAL_ITEM` is seeded first so it lands in slot 1-lunch. Mirrors the
 * direct-db.insert seeding idiom of multi-store.test.ts / dietary-preferences.test.ts.
 */
function seedDiscountItems(dbPath: string, items: Array<{ id: string; name: string; sale: number }>): void {
  const db = createDb(dbPath);
  const now = Date.now();
  const jobId = randomUUID();
  const validUntil = daysFromNow(7);

  db.insert(scrapeJobs).values({
    id: jobId,
    store: STORE,
    status: "completed",
    startedAt: now - 3600 * 1000,
    completedAt: now - 1800 * 1000,
    itemCount: items.length,
  }).run();

  for (const it of items) {
    db.insert(discountItems).values({
      id: it.id,
      store: STORE,
      name: it.name,
      category: "food",
      regularPrice: it.sale + 100,
      salePrice: it.sale,
      validUntil,
      dietaryTags: JSON.stringify(["vegan"]), // vegan → survives any restriction, always in the plan
      scrapeJobId: jobId,
      createdAt: now,
    }).run();
  }
}

/**
 * Raw-seeds a STALE recipes row (design §4 columns) directly, so the cached +
 * dead-source path (§6 refresh-on-expiry) can be driven with zero network.
 *
 * Uses raw bun:sqlite (the established repo idiom — see the migration-boot AT that
 * does bootstrapDb.exec). CREATE TABLE IF NOT EXISTS guards against the recipes
 * table not yet existing in schema.ts, so this seed cannot throw → the AT reaches
 * a RED assertion rather than a BROKEN setup.
 *
 * queryKey MUST equal normalize(meal.name) = meal.name.toLowerCase().trim().
 * cached_at is > 7 days old (expired) and source_url_valid starts at 1, so the
 * service's expiry re-check calls RecipeSource.find; a Fake returning null flips
 * source_url_valid → 0 and returns the stale copy (fallback (a)).
 *
 * Column shape (crafter contract — mirror in schema.ts / SQLiteRecipeRepository):
 *   recipes(id TEXT PK, query_key TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
 *           cached_content TEXT NOT NULL,   -- JSON { ingredients: string[], steps: string[] }
 *           source_url TEXT NOT NULL, source_url_valid INTEGER NOT NULL DEFAULT 1,
 *           cached_at INTEGER NOT NULL)
 */
function seedStaleRecipeRow(
  dbPath: string,
  args: { queryName: string; slot: MealSlot; recipeName: string; ingredients: string[]; steps: string[]; sourceUrl: string },
): void {
  // createDb first so all base tables + PRAGMAs exist, then add recipes if absent.
  createDb(dbPath);
  const raw = new Database(dbPath);
  raw.exec(`
    CREATE TABLE IF NOT EXISTS recipes (
      id TEXT PRIMARY KEY,
      query_key TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      cached_content TEXT NOT NULL,
      source_url TEXT NOT NULL,
      source_url_valid INTEGER NOT NULL DEFAULT 1,
      cached_at INTEGER NOT NULL
    );
  `);

  const eightDaysAgo = Date.now() - 8 * 24 * 60 * 60 * 1000; // beyond 7-day TTL → expired
  raw.query(
    `INSERT INTO recipes (id, query_key, name, cached_content, source_url, source_url_valid, cached_at)
     VALUES (?, ?, ?, ?, ?, 1, ?)`,
  ).run(
    randomUUID(),
    // 12-04: the service keys the cache on the COMPOSED query, so the stale row must
    // be keyed identically (bare meal name + slot term + default params), else the
    // cache lookup misses and the dead-source path never fires.
    composedQueryKey(args.queryName, args.slot),
    args.recipeName,
    JSON.stringify({ ingredients: args.ingredients, steps: args.steps }),
    args.sourceUrl,
    eightDaysAgo,
  );
  raw.close();
}

/** Generate a plan through the driving port so meals exist for GET /plan/{meal_id}. */
async function generatePlan(port: number): Promise<void> {
  await fetch(`http://localhost:${port}/plan/generate`, { method: "POST", redirect: "manual" });
}

// ─── Behavior 1: Recipe detail renders ────────────────────────────────────────
// Design §7 (view content) + B2/B5/B8. FakeRecipeSource returns a known recipe.
// RED reason: no `/plan/{meal_id}` startsWith route + no RecipeHandler → GET /plan/1-lunch
//             falls through to 404 "Not Found"; none of the recipe markers appear.

describe("@driving_port — Recipe detail view renders name, ingredients, steps, original + back links", () => {
  let tmpDir: string;
  let dbPath: string;
  let serverPort: number;
  let server: { stop(): void } | null = null;

  const RECIPE_NAME = "Rote Linsen Suppe";
  const SOURCE_URL = "https://www.chefkoch.de/rezepte/12345/rote-linsen-suppe.html";
  const INGREDIENT_A = "Rote Linsen";
  const INGREDIENT_B = "Kokosmilch";
  const STEP_1 = "Linsen abspülen und in Brühe köcheln.";
  const STEP_2 = "Mit Kokosmilch verfeinern und würzen.";

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "discount-hunt-recipe-detail-"));
    dbPath = join(tmpDir, "recipe-detail.db");
    seedDiscountItems(dbPath, [
      { id: "rec-item-001", name: MEAL_ITEM, sale: MEAL_ITEM_SALE_CENTS },
      { id: "rec-item-002", name: OTHER_ITEM, sale: 99 },
    ]);

    const fake = new FakeRecipeSource(
      new Map<string, FetchedRecipe | null>([
        [MEAL_ITEM.toLowerCase().trim(), {
          name: RECIPE_NAME,
          ingredients: [INGREDIENT_A, INGREDIENT_B],
          steps: [STEP_1, STEP_2],
          sourceUrl: SOURCE_URL,
        }],
      ]),
    );

    const { createServer } = await import("../../../src/server.ts");
    const s = await createServer({ port: 0, dbPath, recipeSource: fake } as any);
    server = s;
    serverPort = s.port;

    await generatePlan(serverPort); // meals now exist; 1-lunch = MEAL_ITEM
  });

  afterAll(() => {
    server?.stop();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("GET /plan/1-lunch returns 200 HTML", async () => {
    const response = await fetch(`http://localhost:${serverPort}/plan/1-lunch`);
    expect(response.status).toBe(200);
  });

  test("the recipe name is shown", async () => {
    const html = await (await fetch(`http://localhost:${serverPort}/plan/1-lunch`)).text();
    expect(html).toContain(RECIPE_NAME);
  });

  test("the ingredient list is shown", async () => {
    const html = await (await fetch(`http://localhost:${serverPort}/plan/1-lunch`)).text();
    expect(html).toContain(INGREDIENT_A);
    expect(html).toContain(INGREDIENT_B);
  });

  test("the preparation steps are shown", async () => {
    const html = await (await fetch(`http://localhost:${serverPort}/plan/1-lunch`)).text();
    expect(html).toContain(STEP_1);
    expect(html).toContain(STEP_2);
  });

  test("an 'Open original recipe' link opens the source URL in a new tab with rel=noopener", async () => {
    const html = await (await fetch(`http://localhost:${serverPort}/plan/1-lunch`)).text();
    // The anchor must carry target=_blank + rel=noopener and point at the source URL.
    const anchor = html.match(/<a\b[^>]*href="https:\/\/www\.chefkoch\.de\/rezepte\/12345[^"]*"[^>]*>/)?.[0] ?? "";
    expect(anchor).toContain(`target="_blank"`);
    expect(anchor).toContain(`rel="noopener"`);
    expect(html).toContain("Open original recipe");
  });

  test("a 'Back to meal plan' link points at /plan", async () => {
    const html = await (await fetch(`http://localhost:${serverPort}/plan/1-lunch`)).text();
    expect(html).toMatch(/<a\b[^>]*href="\/plan"[^>]*>[^<]*Back to meal plan/);
  });
});

// ─── Behavior 2: Ingredient ↔ discount highlighting ───────────────────────────
// Design §9 + B4. A recipe ingredient matching a discount item in THIS week's feed
// is badged with store + sale price; a non-matching ingredient is not.
// RED reason: route unbuilt (404) → no badge markup at all.
//   Anti-Fixture-Theater: the non-matching ingredient control means a naive "badge
//   everything" impl would fail the second assertion.

describe("@driving_port — Ingredient matching a discount item is badged with store + sale price", () => {
  let tmpDir: string;
  let dbPath: string;
  let serverPort: number;
  let server: { stop(): void } | null = null;

  const MATCHING_INGREDIENT = MEAL_ITEM;    // "Rote Linsen" — matches the seeded discount item
  const NON_MATCHING_INGREDIENT = "Kokosmilch"; // no discount item by this name → no badge

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "discount-hunt-recipe-highlight-"));
    dbPath = join(tmpDir, "recipe-highlight.db");
    seedDiscountItems(dbPath, [
      { id: "hl-item-001", name: MEAL_ITEM, sale: MEAL_ITEM_SALE_CENTS },
      { id: "hl-item-002", name: OTHER_ITEM, sale: 99 },
    ]);

    const fake = new FakeRecipeSource(
      new Map<string, FetchedRecipe | null>([
        [MEAL_ITEM.toLowerCase().trim(), {
          name: "Rote Linsen Suppe",
          ingredients: [MATCHING_INGREDIENT, NON_MATCHING_INGREDIENT],
          steps: ["Kochen."],
          sourceUrl: "https://www.chefkoch.de/rezepte/12345/x.html",
        }],
      ]),
    );

    const { createServer } = await import("../../../src/server.ts");
    const s = await createServer({ port: 0, dbPath, recipeSource: fake } as any);
    server = s;
    serverPort = s.port;
    await generatePlan(serverPort);
  });

  afterAll(() => {
    server?.stop();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("the matching ingredient carries a data-on-sale badge with the store name", async () => {
    const html = await (await fetch(`http://localhost:${serverPort}/plan/1-lunch`)).text();
    expect(html).toContain("data-on-sale");
    expect(html).toContain(STORE);
  });

  test("the on-sale badge shows the item's sale price (€1.29)", async () => {
    const html = await (await fetch(`http://localhost:${serverPort}/plan/1-lunch`)).text();
    expect(html).toContain(MEAL_ITEM_SALE_EUROS);
  });

  test("a non-matching ingredient carries no on-sale badge (control)", async () => {
    const html = await (await fetch(`http://localhost:${serverPort}/plan/1-lunch`)).text();
    // Two ingredients, exactly one matching a discount item → exactly ONE badge.
    // A "badge everything" impl would render two → fails; a correct impl renders one.
    // Count-based (not adjacency-based) so a correct §9 impl is never false-RED by the
    // matching ingredient's badge sitting next to the non-matching one in the markup.
    expect(html).toContain(NON_MATCHING_INGREDIENT);
    const badgeCount = (html.match(/data-on-sale/g) ?? []).length;
    expect(badgeCount).toBe(1);
  });
});

// ─── Behavior 3: No-match fallback ────────────────────────────────────────────
// Design §8 fallback (b) + B7. FakeRecipeSource returns null and nothing is cached
// → show the meal's ingredient (= meal.name) + a pre-filled manual web-search link.
// RED reason: route unbuilt (404) → no fallback view rendered.

describe("@driving_port — No-recipe fallback shows the ingredient and a manual search link", () => {
  let tmpDir: string;
  let dbPath: string;
  let serverPort: number;
  let server: { stop(): void } | null = null;

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "discount-hunt-recipe-nomatch-"));
    dbPath = join(tmpDir, "recipe-nomatch.db");
    seedDiscountItems(dbPath, [
      { id: "nm-item-001", name: MEAL_ITEM, sale: MEAL_ITEM_SALE_CENTS },
      { id: "nm-item-002", name: OTHER_ITEM, sale: 99 },
    ]);

    // Fake returns null for everything (empty map) → no match, nothing cached.
    const fake = new FakeRecipeSource(new Map<string, FetchedRecipe | null>());

    const { createServer } = await import("../../../src/server.ts");
    const s = await createServer({ port: 0, dbPath, recipeSource: fake } as any);
    server = s;
    serverPort = s.port;
    await generatePlan(serverPort);
  });

  afterAll(() => {
    server?.stop();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("GET /plan/1-lunch does NOT crash — it returns a 200 fallback view", async () => {
    const response = await fetch(`http://localhost:${serverPort}/plan/1-lunch`);
    expect(response.status).toBe(200);
  });

  test("the meal's ingredient (its name) is shown", async () => {
    const html = await (await fetch(`http://localhost:${serverPort}/plan/1-lunch`)).text();
    expect(html).toContain(MEAL_ITEM);
  });

  test("a pre-filled Chefkoch search link for the ingredient is shown, opening in a new tab", async () => {
    const html = await (await fetch(`http://localhost:${serverPort}/plan/1-lunch`)).text();
    const expectedSearch = `https://www.chefkoch.de/suche.php?suche=${encodeURIComponent(MEAL_ITEM)}`;
    const anchor = html.match(new RegExp(`<a\\b[^>]*href="${expectedSearch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"[^>]*>`))?.[0] ?? "";
    expect(anchor).not.toBe("");
    expect(anchor).toContain(`target="_blank"`);
    expect(anchor).toContain(`rel="noopener"`);
  });

  test("the 'Back to meal plan' link is still present in the fallback view", async () => {
    const html = await (await fetch(`http://localhost:${serverPort}/plan/1-lunch`)).text();
    expect(html).toMatch(/<a\b[^>]*href="\/plan"[^>]*>[^<]*Back to meal plan/);
  });
});

// ─── Behavior 4: Dead/unavailable source fallback ─────────────────────────────
// Design §6 (refresh-on-expiry re-validation seam) + §8 fallback (a) + B6.
// A STALE cached recipe (cached_at > 7d, source_url_valid=1) whose source now
// returns null on re-validation → view shows cached content + "unavailable" notice.
// RED reason: route unbuilt (404); even once built, the notice + cached render is
//             new functionality. The stale row is raw-seeded so setup cannot throw.

describe("@driving_port — Dead source on re-validate shows cached content + 'unavailable' notice", () => {
  let tmpDir: string;
  let dbPath: string;
  let serverPort: number;
  let server: { stop(): void } | null = null;

  const CACHED_RECIPE_NAME = "Zwiebelkuchen";
  const CACHED_INGREDIENT = "Zwiebeln";
  const CACHED_STEP = "Teig ausrollen und belegen.";
  const DEAD_SOURCE_URL = "https://www.chefkoch.de/rezepte/99999/zwiebelkuchen.html";

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "discount-hunt-recipe-dead-"));
    dbPath = join(tmpDir, "recipe-dead.db");
    seedDiscountItems(dbPath, [
      { id: "dd-item-001", name: MEAL_ITEM, sale: MEAL_ITEM_SALE_CENTS },
      { id: "dd-item-002", name: OTHER_ITEM, sale: 99 },
    ]);

    // Stale cached row keyed by the composed query for 1-lunch (= MEAL_ITEM, slot "lunch").
    seedStaleRecipeRow(dbPath, {
      queryName: MEAL_ITEM,
      slot: "lunch",
      recipeName: CACHED_RECIPE_NAME,
      ingredients: [CACHED_INGREDIENT],
      steps: [CACHED_STEP],
      sourceUrl: DEAD_SOURCE_URL,
    });

    // Fake returns null on the expiry re-fetch → §6 flips source_url_valid to 0
    // and returns the stale copy with sourceUrlValid=false → fallback (a).
    const fake = new FakeRecipeSource(new Map<string, FetchedRecipe | null>());

    const { createServer } = await import("../../../src/server.ts");
    const s = await createServer({ port: 0, dbPath, recipeSource: fake } as any);
    server = s;
    serverPort = s.port;
    await generatePlan(serverPort);
  });

  afterAll(() => {
    server?.stop();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("GET /plan/1-lunch returns 200 (does not crash on a dead source)", async () => {
    const response = await fetch(`http://localhost:${serverPort}/plan/1-lunch`);
    expect(response.status).toBe(200);
  });

  test("the cached recipe content (name + ingredient) still renders", async () => {
    const html = await (await fetch(`http://localhost:${serverPort}/plan/1-lunch`)).text();
    expect(html).toContain(CACHED_RECIPE_NAME);
    expect(html).toContain(CACHED_INGREDIENT);
  });

  test("an 'unavailable' notice is shown using the staleness-warning style", async () => {
    const html = await (await fetch(`http://localhost:${serverPort}/plan/1-lunch`)).text();
    expect(html).toContain(`class="staleness-warning"`);
    expect(html.toLowerCase()).toContain("unavailable");
  });

  test("the 'Back to meal plan' link is still present", async () => {
    const html = await (await fetch(`http://localhost:${serverPort}/plan/1-lunch`)).text();
    expect(html).toMatch(/<a\b[^>]*href="\/plan"[^>]*>[^<]*Back to meal plan/);
  });
});

// ─── Behavior 5: Routing intact + graceful not-found ──────────────────────────
// Design §11 (route order: exact /plan + /plan/generate BEFORE startsWith /plan/).
// GET /plan and POST /plan/generate keep working; a bad meal_id → 404 (not 500)
// with a back-link.
// RED status split:
//   - GET /plan → 200, POST /plan/generate → 303 : GREEN today (guard against clobber).
//   - GET /plan/9-brunch → not 500 : GREEN today (falls through to plain 404).
//   - the back-link INSIDE that not-found response : RED (current fallthrough is plain text).

describe("@driving_port — /plan and /plan/generate are not clobbered; bad meal_id is a graceful 404", () => {
  let tmpDir: string;
  let dbPath: string;
  let serverPort: number;
  let server: { stop(): void } | null = null;

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "discount-hunt-recipe-routing-"));
    dbPath = join(tmpDir, "recipe-routing.db");
    seedDiscountItems(dbPath, [
      { id: "rt-item-001", name: MEAL_ITEM, sale: MEAL_ITEM_SALE_CENTS },
      { id: "rt-item-002", name: OTHER_ITEM, sale: 99 },
    ]);

    const fake = new FakeRecipeSource(
      new Map<string, FetchedRecipe | null>([
        [MEAL_ITEM.toLowerCase().trim(), {
          name: "Rote Linsen Suppe",
          ingredients: [MEAL_ITEM],
          steps: ["Kochen."],
          sourceUrl: "https://www.chefkoch.de/rezepte/12345/x.html",
        }],
      ]),
    );

    const { createServer } = await import("../../../src/server.ts");
    const s = await createServer({ port: 0, dbPath, recipeSource: fake } as any);
    server = s;
    serverPort = s.port;
    await generatePlan(serverPort);
  });

  afterAll(() => {
    server?.stop();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("GET /plan still returns the plan view (200) — not clobbered by /plan/{meal_id}", async () => {
    const response = await fetch(`http://localhost:${serverPort}/plan`);
    expect(response.status).toBe(200);
    const html = await response.text();
    // The plan table (or its meals) must still render — MEAL_ITEM appears as a meal.
    expect(html).toContain(MEAL_ITEM);
  });

  test("POST /plan/generate still redirects (303) — not clobbered", async () => {
    const response = await fetch(`http://localhost:${serverPort}/plan/generate`, {
      method: "POST",
      redirect: "manual",
    });
    expect(response.status).toBe(303);
  });

  test("GET /plan/{bad-id} that is not a real meal returns 404, never 500", async () => {
    const response = await fetch(`http://localhost:${serverPort}/plan/9-brunch`);
    expect(response.status).not.toBe(500);
    expect(response.status).toBe(404);
  });

  test("the not-found response offers a 'Back to meal plan' link", async () => {
    const html = await (await fetch(`http://localhost:${serverPort}/plan/9-brunch`)).text();
    expect(html).toMatch(/<a\b[^>]*href="\/plan"[^>]*>[^<]*Back to meal plan/);
  });
});

// ─── Behavior 6: Meal titles link to detail ───────────────────────────────────
// Design §10 + B9. GET /plan renders each meal name as a link to /plan/{day}-{slot}.
// RED reason: plan-handler.ts:87 currently renders `<td>${escapeHtml(meal.name)}</td>`
//             with NO anchor → href="/plan/1-lunch" absent.

describe("@driving_port — Plan view renders each meal name as a link to its recipe detail", () => {
  let tmpDir: string;
  let dbPath: string;
  let serverPort: number;
  let server: { stop(): void } | null = null;

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "discount-hunt-recipe-planlinks-"));
    dbPath = join(tmpDir, "recipe-planlinks.db");
    seedDiscountItems(dbPath, [
      { id: "pl-item-001", name: MEAL_ITEM, sale: MEAL_ITEM_SALE_CENTS },
      { id: "pl-item-002", name: OTHER_ITEM, sale: 99 },
    ]);

    const fake = new FakeRecipeSource(new Map<string, FetchedRecipe | null>());

    const { createServer } = await import("../../../src/server.ts");
    const s = await createServer({ port: 0, dbPath, recipeSource: fake } as any);
    server = s;
    serverPort = s.port;
    await generatePlan(serverPort);
  });

  afterAll(() => {
    server?.stop();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("the first meal (1-lunch) name is wrapped in a link to /plan/1-lunch", async () => {
    const html = await (await fetch(`http://localhost:${serverPort}/plan`)).text();
    // Anchor to the detail route wrapping the meal name.
    expect(html).toMatch(/<a\b[^>]*href="\/plan\/1-lunch"[^>]*>/);
  });

  test("the day-1 dinner meal links to /plan/1-dinner", async () => {
    const html = await (await fetch(`http://localhost:${serverPort}/plan`)).text();
    expect(html).toMatch(/<a\b[^>]*href="\/plan\/1-dinner"[^>]*>/);
  });
});

// ─── Behavior 7: XSS escaping in the detail view ──────────────────────────────
// Design §1 (security) + §7 (all interpolated text escaped) + B12.
// A Fake recipe with an HTML-special name/ingredient must render escaped.
// RED reason: route unbuilt (404) → nothing rendered; once built, unescaped
//             interpolation would leak the raw <script>.

describe("@driving_port — Recipe fields with HTML special chars are escaped in the detail view", () => {
  let tmpDir: string;
  let dbPath: string;
  let serverPort: number;
  let server: { stop(): void } | null = null;

  const XSS_RECIPE_NAME = `<script>alert('recipe')</script> Suppe`;
  const XSS_RECIPE_NAME_ESCAPED = `&lt;script&gt;alert(&#39;recipe&#39;)&lt;/script&gt; Suppe`;
  const XSS_INGREDIENT = `<img src=x onerror=alert(1)> Linsen`;
  const XSS_INGREDIENT_ESCAPED = `&lt;img src=x onerror=alert(1)&gt; Linsen`;

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "discount-hunt-recipe-xss-"));
    dbPath = join(tmpDir, "recipe-xss.db");
    seedDiscountItems(dbPath, [
      { id: "xss-item-001", name: MEAL_ITEM, sale: MEAL_ITEM_SALE_CENTS },
      { id: "xss-item-002", name: OTHER_ITEM, sale: 99 },
    ]);

    const fake = new FakeRecipeSource(
      new Map<string, FetchedRecipe | null>([
        [MEAL_ITEM.toLowerCase().trim(), {
          name: XSS_RECIPE_NAME,
          ingredients: [XSS_INGREDIENT],
          steps: ["Kochen."],
          sourceUrl: "https://www.chefkoch.de/rezepte/12345/x.html",
        }],
      ]),
    );

    const { createServer } = await import("../../../src/server.ts");
    const s = await createServer({ port: 0, dbPath, recipeSource: fake } as any);
    server = s;
    serverPort = s.port;
    await generatePlan(serverPort);
  });

  afterAll(() => {
    server?.stop();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("the recipe name is HTML-escaped (no raw <script>)", async () => {
    const html = await (await fetch(`http://localhost:${serverPort}/plan/1-lunch`)).text();
    expect(html).not.toContain("<script>alert('recipe')</script>");
    expect(html).toContain(XSS_RECIPE_NAME_ESCAPED);
  });

  test("the ingredient text is HTML-escaped (no raw <img onerror>)", async () => {
    const html = await (await fetch(`http://localhost:${serverPort}/plan/1-lunch`)).text();
    expect(html).not.toContain("<img src=x onerror=alert(1)>");
    expect(html).toContain(XSS_INGREDIENT_ESCAPED);
  });
});
