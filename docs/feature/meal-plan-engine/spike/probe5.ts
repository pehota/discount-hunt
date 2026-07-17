/**
 * SPIKE-00 RUN 5 — A/B test the one UNMEASURED dietary lever from run 4:
 * does FORCING "vegetarisch" into the query prevent the meat leaks?
 *
 * Reuses run-4's searched baskets + their EXACT queries (run 4 = NO dietary term,
 * the LLM dropped it) and appends " vegetarisch" — the only changed variable.
 * Same polite protocol (1 search/basket, 25s spacing, browser headers, backoff),
 * same word-boundary blocklist + fixed matcher over full ingredient lists.
 * Compare leak rate vs run 4. Not production code. Run in the background.
 */
import { ChefkochRecipeSource } from "/home/mitko/Work/discount-hunt/src/recipe/adapters/chefkoch-recipe-source.ts";
import { tokensOverlap } from "/home/mitko/Work/discount-hunt/src/recipe/ingredient-match.ts";

const R4 = "/home/mitko/Work/discount-hunt/docs/feature/meal-plan-engine/spike/raw-results-4.json";
const OUT = "/home/mitko/Work/discount-hunt/docs/feature/meal-plan-engine/spike/raw-results-5.json";
const SPACING_MS = 25000, BACKOFF_MS = 120000, FETCH_TIMEOUT_MS = 15000;
const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "de-DE,de;q=0.9,en;q=0.8",
};
const MEAT_FISH_RE = new RegExp("\\b(" + [
  "fleisch","hähnchen","huhn","hühnchen","pute","puten","rind","schwein","hackfleisch","hack","speck",
  "schinken","wurst","salami","bacon","lamm","ente","kalb","gulasch","steak","geflügel","kasseler","leber",
  "cabanossi","chorizo","prosciutto","sausage","beef","pork","chicken","fisch","lachs","thunfisch","garnele",
  "shrimp","krabbe","forelle","hering","sardelle","sardine","kabeljau","dorsch","muschel","tintenfisch",
  "scampi","meeresfrüchte","hummer","makrele","anchovis","salmon","tuna","prawn",
].join("|") + ")\\w*\\b", "i");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const fx = (u: string) => fetch(u, { headers: HEADERS, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
const leaks = (ings: string[]) => ings.filter((i) => MEAT_FISH_RE.test(i));
const RECIPE_LINK = /\/rezepte\/\d+\/[^"'\s]+\.html/;
function strictUses(product: string, ings: string[]): boolean {
  const toks = (s: string) => new Set(s.toLowerCase().split(/[^a-zäöüß0-9]+/i).filter((t) => t.length >= 4));
  const p = toks(product);
  return ings.some((i) => { for (const t of toks(i)) if (p.has(t)) return true; return false; });
}
async function status(q: string) {
  try { const r = await fx("https://www.chefkoch.de/suche.php?suche=" + encodeURIComponent(q));
    return r.status; } catch { return -1; }
}

async function main() {
  const r4 = JSON.parse(await Bun.file(R4).text());
  const searched = r4.results.filter((r: any) => r.refused !== true && r.skipped === undefined && r.query);
  const source = new ChefkochRecipeSource(fx as typeof fetch);
  const results: unknown[] = [];
  for (const b of searched) {
    const query = `${b.query} vegetarisch`; // the ONLY change vs run 4
    let recipe = await source.find(query), st = 200;
    if (!recipe) {
      st = await status(query);
      if (st === 429) { await sleep(BACKOFF_MS); recipe = await source.find(query); if (!recipe) st = await status(query); }
    }
    let strict = 0, ls: string[] = [], ings: string[] = [], name = "";
    if (recipe) { name = recipe.name; ings = recipe.ingredients; st = 200;
      for (const p of b.products) if (strictUses(p, ings)) strict++;
      ls = leaks(ings); }
    results.push({ basket: b.basket, products: b.products, query,
      run4Query: b.query, run4LeakCount: b.dietaryLeakCount, run4Recipe: b.recipeName,
      found: Boolean(recipe), status: st, recipeName: name, strictUsed: strict, strictGte1: strict >= 1,
      dietaryLeakCount: ls.length, dietaryLeaks: ls, ingredients: ings });
    console.error(`[${st}] ${b.basket} found=${Boolean(recipe)} strU=${strict} leak=${ls.length} (run4 leak=${b.dietaryLeakCount}) "${name.slice(0,38)}" q="${query.slice(0,45)}"`);
    await sleep(SPACING_MS);
  }
  const found = results.filter((r: any) => r.found);
  const summary = {
    searched: searched.length, found: found.length,
    strictGte1: found.filter((r: any) => r.strictGte1).length,
    withDietaryLeak_run5_forcedVegetarisch: found.filter((r: any) => r.dietaryLeakCount > 0).length,
    run4_leakers: searched.filter((r: any) => r.dietaryLeakCount > 0).map((r: any) => r.basket),
  };
  await Bun.write(OUT, JSON.stringify({ summary, results }, null, 2));
  console.error("\nSUMMARY:", JSON.stringify(summary));
}
main();
