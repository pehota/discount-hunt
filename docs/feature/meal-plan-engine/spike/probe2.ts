/**
 * SPIKE-00 harness RUN 2 (meal-plan-engine) — fixes run-1 methodology flaws.
 * Run 1 (raw-results.json) failed partly for fixable reasons: non-food items
 * (Household/Other categories), brand noise in queries, and unrealistic baskets.
 *
 * Run 2: FOOD-only (exclude Household/Other), realistic CROSS-category baskets of
 * simplest-named (least brand-noise) items, an improved brand-stripping LLM query
 * prompt, and the same measures (lenient/strict >=2 used, dietary leak scan).
 * Reuses real seams; reads DB read-only; rate-limited. Not production code.
 */
import { Database } from "bun:sqlite";
import { ChefkochRecipeSource } from "/home/mitko/Work/discount-hunt/src/recipe/adapters/chefkoch-recipe-source.ts";
import { tokensOverlap } from "/home/mitko/Work/discount-hunt/src/recipe/ingredient-match.ts";
import { resolveLlm } from "/home/mitko/Work/discount-hunt/src/llm/resolve-llm.ts";

const DB = "/home/mitko/Work/discount-hunt/discount-hunt.db";
const OUT = "/home/mitko/Work/discount-hunt/docs/feature/meal-plan-engine/spike/raw-results-2.json";
const FETCH_TIMEOUT_MS = 15000;
const DELAY_MS = 900;
const NON_FOOD_TAX = new Set(["Household", "Other"]);

const MEAT_FISH = [
  "fleisch","hähnch","hahnch","hühn","huhn","pute","puten","rind","schwein","hack","speck",
  "schinken","wurst","salami","bacon","lamm","ente","kalb","gulasch","steak","geflügel","kassel",
  "leber","cabanoss","chorizo","prosciutto","sausage","mince","beef","pork","chicken","fisch",
  "lachs","thunfisch","thun","garnele","shrimp","krabbe","forelle","hering","sardell","sardine",
  "kabeljau","dorsch","muschel","tintenfisch","scampi","meeresfrücht","hummer","makrele","anchov",
  "salmon","tuna","prawn",
];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const cleanName = (n: string) =>
  n.split(/[,(]/)[0]!.replace(/\d+\s*(g|kg|ml|l|stk|stück)\b/gi, "").trim();
const wordCount = (s: string) => cleanName(s).split(/\s+/).filter(Boolean).length;

function strictUses(productName: string, ingredients: string[]): boolean {
  const toks = (s: string) =>
    new Set(s.toLowerCase().split(/[^a-zäöüß0-9]+/i).filter((t) => t.length >= 4));
  const p = toks(productName);
  return ingredients.some((ing) => { for (const t of toks(ing)) if (p.has(t)) return true; return false; });
}
function dietaryLeak(ings: string[]): string[] {
  const hits: string[] = [];
  for (const ing of ings) { const low = ing.toLowerCase();
    for (const m of MEAT_FISH) if (low.includes(m)) { hits.push(`${ing} ~${m}`); break; } }
  return hits;
}
const fetchWithTimeout = (url: string, init: RequestInit = {}) =>
  fetch(url, { ...init, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });

async function llmQuery(products: string[]): Promise<string> {
  const llm = resolveLlm();
  if (!llm) return "";
  const system =
    "You are given German grocery products that may include BRAND names and descriptors. " +
    "IGNORE brands/descriptors; identify the core FOOD ingredients; pick 2-3 that plausibly make ONE " +
    "vegetarian dish; output ONLY a short German chefkoch.de search query (dish + key ingredients), " +
    "max 6 words, no quotes, no explanation.";
  try { return (await llm.run(system, `Products: ${products.join(", ")}\nDiet: vegetarian`))
    .trim().split("\n")[0]!.slice(0, 120); }
  catch (e) { return `LLM_ERROR: ${String(e)}`; }
}

async function main() {
  const db = new Database(DB, { readonly: true });
  const rows = db.query(
    `SELECT d.name, d.taxonomy_category AS tax, d.dietary_tags AS tags, s.name AS store
     FROM discount_items d JOIN stores s ON s.id = d.store_id`,
  ).all() as { name: string; tax: string | null; tags: string; store: string }[];
  db.close();

  const veg = rows.filter((r) => {
    let t: string[] = []; try { t = JSON.parse(r.tags); } catch {}
    const foodTax = r.tax && !NON_FOOD_TAX.has(r.tax);
    return foodTax && !t.includes("contains-meat") && !t.includes("contains-fish");
  });

  // Per food category, keep the SIMPLEST-named items (fewest words = least brand noise).
  const byTax = new Map<string, string[]>();
  for (const r of veg) { if (!byTax.has(r.tax!)) byTax.set(r.tax!, []); byTax.get(r.tax!)!.push(r.name); }
  const simplest = new Map<string, string[]>();
  for (const [tax, names] of byTax)
    simplest.set(tax, names.slice().sort((a, b) => wordCount(a) - wordCount(b) || a.localeCompare(b)).slice(0, 6));

  const foodCats = [...simplest.keys()].sort();
  console.error("food categories:", foodCats.join(", "));
  for (const c of foodCats) console.error(`  ${c}: ${simplest.get(c)!.slice(0, 4).join(" | ")}`);

  // Realistic CROSS-category baskets: one simplest item from each of 2-3 different food cats.
  const baskets: { label: string; products: string[] }[] = [];
  const pick = (cat: string, i: number) => simplest.get(cat)?.[i];
  const combos: string[][] = [
    ["Produce", "Dairy & Cheese", "Pantry"],
    ["Produce", "Pantry"],
    ["Dairy & Cheese", "Bakery"],
    ["Produce", "Dairy & Cheese"],
    ["Pantry", "Dairy & Cheese", "Produce"],
    ["Produce", "Bakery", "Dairy & Cheese"],
  ];
  let idx = 0;
  for (const combo of combos) {
    for (let r = 0; r < 2; r++) {
      const products = combo.map((c) => pick(c, r)).filter((x): x is string => Boolean(x));
      if (products.length >= 2) baskets.push({ label: `${combo.join("+")}#${r}`, products });
      idx++;
    }
  }
  console.error(`\nbaskets=${baskets.length}\n`);

  const source = new ChefkochRecipeSource(fetchWithTimeout as typeof fetch);
  const results: unknown[] = [];
  for (const basket of baskets) {
    for (const strategy of ["rules", "llm"] as const) {
      const cleaned = basket.products.map(cleanName).filter(Boolean);
      const query = strategy === "rules"
        ? [...cleaned.slice(0, 3), "vegetarisch", "Rezept"].join(" ")
        : await llmQuery(basket.products);

      let found = false, name = "", url = "", ingCount = 0, lenient = 0, strict = 0, leaks: string[] = [];
      if (query && !query.startsWith("LLM_ERROR")) {
        const recipe = await source.find(query);
        if (recipe) {
          found = true; name = recipe.name; url = recipe.sourceUrl; ingCount = recipe.ingredients.length;
          for (const p of basket.products) {
            if (recipe.ingredients.some((ing) => tokensOverlap(p, ing))) lenient++;
            if (strictUses(p, recipe.ingredients)) strict++;
          }
          leaks = dietaryLeak(recipe.ingredients);
        }
        await sleep(DELAY_MS);
      }
      results.push({ basket: basket.label, products: basket.products, strategy, query,
        found, recipeName: name, url, ingredientCount: ingCount,
        lenientProductsUsed: lenient, strictProductsUsed: strict,
        lenientGte2: lenient >= 2, strictGte2: strict >= 2,
        dietaryLeakCount: leaks.length, dietaryLeaks: leaks });
      console.error(`[${strategy}] ${basket.label} found=${found} lenU=${lenient} strU=${strict} leak=${leaks.length} "${name.slice(0,40)}" q="${query.slice(0,55)}"`);
    }
  }
  await Bun.write(OUT, JSON.stringify({ generatedBaskets: baskets.length, results }, null, 2));
  console.error(`\nWROTE ${results.length} records to ${OUT}`);
}
main();
