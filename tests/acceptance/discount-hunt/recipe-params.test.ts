/**
 * Acceptance Tests — PHASE 12: meal-type-scoped recipe links + composed meal-aware query.
 *
 * Shared phase-12 test file (roadmap step 12-04). Source of truth: design phase 12
 * (recipe-search params + meal-aware query composition) and roadmap 12-04 criteria.
 * Wave: DISTILL-authored contract, DELIVER-executed (12-04 lists this file in
 * files_to_modify with an explicit authoring directive).
 *
 * ── NO NETWORK ──────────────────────────────────────────────────────────────
 * The live ChefkochRecipeSource must NEVER be reached. The seam is the driven
 * `RecipeSource` port. A deterministic in-memory FakeRecipeSource is injected via
 * createServer; it RECORDS every query so the composed-query contract is asserted
 * against the captured query with zero I/O. Ephemeral port (createServer({port:0}).
 *
 * ── CONTRACT UNDER TEST (12-04) ─────────────────────────────────────────────
 *   1. GET /plan renders a recipe link ONLY for meals whose slot ∈ prefs.mealTypes.
 *      A meal whose slot is NOT selected renders its name without an <a> link.
 *   2. GET /plan/{day}-{slot} composes the recipe query via
 *      getRecipeForMeal(name, slot, prefs); the captured FakeRecipeSource query
 *      contains the meal-type term + every enabled param.
 *
 * ── FakeRecipeSource behavior ───────────────────────────────────────────────
 *   Empty canned map → every find() returns null (no-match fallback) but RECORDS the
 *   composed query. A cache MISS is forced (no recipe row seeded for the dinner key),
 *   so the composed query is actually sent to the source and captured in `calls`.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { createDb } from "../../../src/shared/db.ts";
import { scrapeJobs, discountItems } from "../../../src/shared/schema.ts";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

// ─── Structural port shape (declared in-test; matches design §3) ──────────────

type FetchedRecipe = {
  name: string;
  ingredients: string[];
  steps: string[];
  sourceUrl: string;
};

/**
 * Deterministic, in-memory RecipeSource that RECORDS every query it is asked for.
 * Empty canned map → find() always returns null (no-match) while capturing the query
 * so the composed-query contract can be asserted against `calls`.
 */
class RecordingRecipeSource {
  public readonly calls: string[] = [];
  async find(query: string): Promise<FetchedRecipe | null> {
    this.calls.push(query);
    return null;
  }
}

const STORE = "Aldi Süd";

// Two vegan items so day-1 lunch AND dinner are both populated in the generated plan.
const LUNCH_ITEM = "Rote Linsen"; // 1-lunch
const DINNER_ITEM = "Zucchini";   // 1-dinner

function daysFromNow(n: number): string {
  return new Date(Date.now() + n * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

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
      dietaryTags: JSON.stringify(["vegan"]), // vegan → survives vegetarian restriction, always in plan
      scrapeJobId: jobId,
      createdAt: now,
    }).run();
  }
}

async function generatePlan(port: number): Promise<void> {
  await fetch(`http://localhost:${port}/plan/generate`, { method: "POST", redirect: "manual" });
}

/** POST the phase-12 recipe params to /settings, x-www-form-urlencoded (exact field names). */
async function saveParams(port: number): Promise<void> {
  const form = new URLSearchParams();
  form.set("dietary", "vegetarian");
  form.set("kidFriendly", "on"); // presence = enabled
  form.set("householdSize", "4");
  form.set("cookingTime", "quick");
  form.append("mealTypes", "dinner"); // ONLY dinner in scope
  await fetch(`http://localhost:${port}/settings`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: form.toString(),
    redirect: "manual",
  });
}

describe("@driving_port — plan link scope + composed query end-to-end", () => {
  let tmpDir: string;
  let dbPath: string;
  let serverPort: number;
  let server: { stop(): void } | null = null;
  let source: RecordingRecipeSource;

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "discount-hunt-recipe-params-"));
    dbPath = join(tmpDir, "recipe-params.db");
    seedDiscountItems(dbPath, [
      { id: "rp-item-001", name: LUNCH_ITEM, sale: 129 },
      { id: "rp-item-002", name: DINNER_ITEM, sale: 99 },
    ]);

    source = new RecordingRecipeSource();

    const { createServer } = await import("../../../src/server.ts");
    const s = await createServer({ port: 0, dbPath, recipeSource: source } as any);
    server = s;
    serverPort = s.port;

    // Plan first (mealTypes does not affect the generated meal set — lunch+dinner both exist),
    // then save the phase-12 params so GET /plan + GET /plan/{id} read them live.
    await generatePlan(serverPort);
    await saveParams(serverPort);
  });

  afterAll(() => {
    server?.stop();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("GET /plan links dinner meals (dinner ∈ mealTypes)", async () => {
    const html = await (await fetch(`http://localhost:${serverPort}/plan`)).text();
    expect(html).toMatch(/href="\/plan\/\d+-dinner"/);
  });

  test("GET /plan does NOT link lunch meals (lunch ∉ mealTypes) — its name renders unlinked", async () => {
    const html = await (await fetch(`http://localhost:${serverPort}/plan`)).text();
    // Scoping discriminator: no lunch anchor at all, yet the lunch meal name is present.
    expect(html).not.toMatch(/href="\/plan\/\d+-lunch"/);
    expect(html).toContain(LUNCH_ITEM);
  });

  test("GET /plan/1-dinner composes the query with the meal-type term + all enabled params", async () => {
    await fetch(`http://localhost:${serverPort}/plan/1-dinner`);
    // The RecordingRecipeSource captured the composed query sent to the source (cache miss).
    const composed = source.calls.find((q) => q.includes("Abendessen")) ?? "";
    expect(composed).toContain("Abendessen");        // meal-type term (dinner)
    expect(composed).toContain("vegetarisch");        // dietary=vegetarian
    expect(composed).toContain("kinderfreundlich");   // kidFriendly on
    expect(composed).toContain("für 4 Personen");     // householdSize=4
    expect(composed).toContain("schnell");            // cookingTime=quick
  });
});
