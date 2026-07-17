/**
 * SPIKE-00 harness (meal-plan-engine, slice-00) — NOT production code.
 *
 * Question: given a basket of N discounted products + a dietary restriction, can a
 * web/Chefkoch search return REAL recipes that use >=2 of the basket products AND
 * are dietary-compatible? And does an LLM-built query beat a rules-built query?
 *
 * Reuses the REAL production seams: ChefkochRecipeSource.find (live network),
 * tokensOverlap (the app's ingredient-match heuristic), resolveLlm (claude-cli).
 * Reads the real discount_items READ-ONLY (bun:sqlite, no createDb → no mutation).
 * Writes raw results JSON for the workflow to analyse. Rate-limited + timeouts.
 */
import { Database } from "bun:sqlite";
import { ChefkochRecipeSource } from "/home/mitko/Work/discount-hunt/src/recipe/adapters/chefkoch-recipe-source.ts";
import { tokensOverlap } from "/home/mitko/Work/discount-hunt/src/recipe/ingredient-match.ts";
import { resolveLlm } from "/home/mitko/Work/discount-hunt/src/llm/resolve-llm.ts";

const DB = "/home/mitko/Work/discount-hunt/discount-hunt.db";
const OUT = "/home/mitko/Work/discount-hunt/docs/feature/meal-plan-engine/spike/raw-results.json";
const FETCH_TIMEOUT_MS = 15000;
const DELAY_MS = 900;

// German meat/fish markers — deterministic dietary-leak scan over recipe ingredients.
const MEAT_FISH = [
  "fleisch","hähnch","hahnch","hühn","huhn","pute","puten","rind","schwein","hack",
  "speck","schinken","wurst","salami","bacon","lamm","ente","kalb","gulasch","steak",
  "geflügel","kassel","leber","cabanoss","chorizo","prosciutto","sausage","mince","beef",
  "pork","chicken","fisch","lachs","thunfisch","thun","garnele","shrimp","krabbe","forelle",
  "hering","sardell","sardine","kabeljau","dorsch","muschel","tintenfisch","scampi",
  "meeresfrücht","hummer","makrele","anchov","salmon","tuna","prawn",
];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Clean a raw discount name into a searchable term: text before comma/paren, trimmed. */
function cleanName(name: string): string {
  return name.split(/[,(]/)[0]!.replace(/\d+\s*(g|kg|ml|l|stk|stück)\b/gi, "").trim();
}

/** Strict match: a significant (len>=4) token of the product equals one of the ingredient. */
function strictUses(productName: string, ingredients: string[]): boolean {
  const toks = (s: string) =>
    new Set(s.toLowerCase().split(/[^a-zäöüß0-9]+/i).filter((t) => t.length >= 4));
  const p = toks(productName);
  return ingredients.some((ing) => {
    for (const t of toks(ing)) if (p.has(t)) return true;
    return false;
  });
}

function dietaryLeak(ingredients: string[]): string[] {
  const hits: string[] = [];
  for (const ing of ingredients) {
    const low = ing.toLowerCase();
    for (const m of MEAT_FISH) if (low.includes(m)) { hits.push(`${ing} ~${m}`); break; }
  }
  return hits;
}

async function fetchWithTimeout(url: string, init: RequestInit = {}): Promise<Response> {
  return fetch(url, { ...init, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
}

async function llmQuery(products: string[]): Promise<string | null> {
  const llm = resolveLlm();
  if (!llm) return null;
  const system =
    "You build ONE German recipe search query for chefkoch.de. Given grocery products and a diet, " +
    "output ONLY the query text (no quotes, no explanation) that finds a real recipe using as many " +
    "of these products as possible and matching the diet. Keep it short (<= 8 words).";
  const user = `Products: ${products.join(", ")}\nDiet: vegetarian`;
  try {
    const out = await llm.run(system, user);
    return out.trim().split("\n")[0]!.slice(0, 120);
  } catch (e) {
    return `LLM_ERROR: ${String(e)}`;
  }
}

async function main() {
  // 1) Read vegetarian-compatible discounted products READ-ONLY.
  const db = new Database(DB, { readonly: true });
  const rows = db
    .query(
      `SELECT d.name, d.category, d.taxonomy_category AS tax, d.dietary_tags AS tags, s.name AS store
       FROM discount_items d JOIN stores s ON s.id = d.store_id`,
    )
    .all() as { name: string; category: string; tax: string | null; tags: string; store: string }[];
  db.close();

  const veg = rows.filter((r) => {
    let t: string[] = [];
    try { t = JSON.parse(r.tags); } catch { t = []; }
    return !t.includes("contains-meat") && !t.includes("contains-fish");
  });

  // 2) Build deterministic baskets: group by taxonomy_category, take 3-4 per group;
  //    plus a couple of cross-category mixed baskets. Realistic user selections.
  const byTax = new Map<string, typeof veg>();
  for (const r of veg) {
    const k = r.tax ?? "Other";
    if (!byTax.has(k)) byTax.set(k, []);
    byTax.get(k)!.push(r);
  }
  const baskets: { label: string; products: string[] }[] = [];
  for (const [tax, items] of [...byTax.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (items.length < 2) continue;
    const sorted = items.slice().sort((a, b) => a.name.localeCompare(b.name));
    baskets.push({ label: `cat:${tax}`, products: sorted.slice(0, 4).map((i) => i.name) });
  }
  // Mixed baskets: one item from each of the first few categories (cross-category realism).
  const catFirsts = [...byTax.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([, items]) => items.slice().sort((a, b) => a.name.localeCompare(b.name))[0]!.name);
  for (let i = 0; i + 2 < catFirsts.length; i += 3) {
    baskets.push({ label: `mixed:${i}`, products: catFirsts.slice(i, i + 3) });
  }

  console.error(`veg items=${veg.length}, categories=${byTax.size}, baskets=${baskets.length}`);

  const source = new ChefkochRecipeSource(fetchWithTimeout as typeof fetch);
  const results: unknown[] = [];

  for (const basket of baskets) {
    for (const strategy of ["rules", "llm"] as const) {
      const cleaned = basket.products.map(cleanName).filter(Boolean);
      let query: string;
      if (strategy === "rules") {
        query = [...cleaned.slice(0, 3), "vegetarisch", "Rezept"].join(" ");
      } else {
        const q = await llmQuery(basket.products);
        query = q ?? "";
      }

      let found = false, name = "", url = "", ingCount = 0;
      let lenientUsed = 0, strictUsed = 0;
      let leaks: string[] = [];
      if (query && !query.startsWith("LLM_ERROR")) {
        const recipe = await source.find(query);
        if (recipe) {
          found = true;
          name = recipe.name;
          url = recipe.sourceUrl;
          ingCount = recipe.ingredients.length;
          for (const p of basket.products) {
            if (recipe.ingredients.some((ing) => tokensOverlap(p, ing))) lenientUsed++;
            if (strictUses(p, recipe.ingredients)) strictUsed++;
          }
          leaks = dietaryLeak(recipe.ingredients);
        }
        await sleep(DELAY_MS);
      }

      const rec = {
        basket: basket.label, products: basket.products, strategy, query,
        found, recipeName: name, url, ingredientCount: ingCount,
        lenientProductsUsed: lenientUsed, strictProductsUsed: strictUsed,
        lenientGte2: lenientUsed >= 2, strictGte2: strictUsed >= 2,
        dietaryLeakCount: leaks.length, dietaryLeaks: leaks,
      };
      results.push(rec);
      console.error(
        `[${strategy}] ${basket.label} found=${found} lenU=${lenientUsed} strU=${strictUsed} leak=${leaks.length} q="${query.slice(0, 60)}"`,
      );
    }
  }

  await Bun.write(OUT, JSON.stringify({ generatedBaskets: baskets.length, results }, null, 2));
  console.error(`\nWROTE ${results.length} records to ${OUT}`);
}

main();
