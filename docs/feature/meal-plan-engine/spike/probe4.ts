/**
 * SPIKE-00 MICRO-PROBE (RUN 4) — closes the one UNMEASURED gap from findings-00 §7.
 *
 * Answers two open questions the earlier runs could not (429-contaminated):
 *  (Q1) Throttled-live viability: can a POLITE, self-throttled client (browser-like
 *       headers, 1 search/basket, >=35s spacing, backoff) sustain ~a plan's worth of
 *       searches (~10) WITHOUT tripping 429? (skeptic A's unmeasured "clean threshold")
 *  (Q2) Clean coverage + dietary: on valid found=true food baskets, what is the
 *       >=1-product and >=2-product hit rate (with a FIXED word-boundary matcher, not
 *       the over-matching tokensOverlap), and the dietary leak rate on FULL ingredient
 *       lists using a WORD-BOUNDARY non-veg blocklist?
 *
 * Uses the LLM to build the query (the D1 "LLM-query -> web-search" option), with a
 * refusal-sentinel so refusal prose is never searched. Reads DB read-only. Self-polls
 * the 429 out (up to ~40 min). Not production code. Run in the BACKGROUND.
 */
import { Database } from "bun:sqlite";
import { ChefkochRecipeSource } from "/home/mitko/Work/discount-hunt/src/recipe/adapters/chefkoch-recipe-source.ts";
import { tokensOverlap } from "/home/mitko/Work/discount-hunt/src/recipe/ingredient-match.ts";
import { resolveLlm } from "/home/mitko/Work/discount-hunt/src/llm/resolve-llm.ts";

const DB = "/home/mitko/Work/discount-hunt/discount-hunt.db";
const OUT = "/home/mitko/Work/discount-hunt/docs/feature/meal-plan-engine/spike/raw-results-4.json";
const NON_FOOD_TAX = new Set(["Household", "Other"]);
const SPACING_MS = 35000;       // polite spacing between searches
const BACKOFF_MS = 300000;      // wait on a mid-run 429
const POLL_WAIT_MS = 300000;    // wait between liveness polls
const MAX_POLLS = 8;            // ~40 min max cooldown
const FETCH_TIMEOUT_MS = 15000;

// Browser-like headers — test a WELL-BEHAVED client, not a bare bot.
const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "de-DE,de;q=0.9,en;q=0.8",
};
// Word-boundary non-veg blocklist (fixes the substring false-positives: "hack" in "gehackt").
const MEAT_FISH_RE = new RegExp(
  "\\b(" + [
    "fleisch","hähnchen","huhn","hühnchen","pute","puten","rind","schwein","hackfleisch","hack",
    "speck","schinken","wurst","salami","bacon","lamm","ente","kalb","gulasch","steak","geflügel",
    "kasseler","leber","cabanossi","chorizo","prosciutto","sausage","beef","pork","chicken",
    "fisch","lachs","thunfisch","garnele","shrimp","krabbe","forelle","hering","sardelle","sardine",
    "kabeljau","dorsch","muschel","tintenfisch","scampi","meeresfrüchte","hummer","makrele","anchovis",
    "salmon","tuna","prawn",
  ].join("|") + ")\\w*\\b", "i");

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const cleanName = (n: string) => n.split(/[,(]/)[0]!.replace(/\d+\s*(g|kg|ml|l|stk|stück)\b/gi, "").trim();
const wordCount = (s: string) => cleanName(s).split(/\s+/).filter(Boolean).length;
const fx = (u: string) => fetch(u, { headers: HEADERS, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });

/** FIXED strict matcher: word-boundary significant-token (len>=4) equality — no substring. */
function strictUses(product: string, ings: string[]): boolean {
  const toks = (s: string) => new Set(s.toLowerCase().split(/[^a-zäöüß0-9]+/i).filter((t) => t.length >= 4));
  const p = toks(product);
  return ings.some((i) => { for (const t of toks(i)) if (p.has(t)) return true; return false; });
}
function dietaryLeaks(ings: string[]): string[] {
  return ings.filter((i) => MEAT_FISH_RE.test(i));
}
function looksLikeRefusal(q: string): boolean {
  const low = q.toLowerCase();
  return q.length > 90 || /\b(cannot|can't|i need|contradiction|clarify|sorry|unable|these products|not (a )?food)\b/.test(low);
}

async function llmQuery(products: string[]): Promise<string> {
  const llm = resolveLlm();
  if (!llm) return "";
  const system =
    "You are given German grocery products that may include BRAND names and descriptors. IGNORE " +
    "brands/descriptors; identify the core FOOD ingredients; pick 2-3 that plausibly make ONE vegetarian " +
    "dish; output ONLY a short German chefkoch.de search query (dish + key ingredients), max 6 words, no " +
    "quotes, no explanation. If the products cannot make a vegetarian dish, output exactly: SKIP";
  try {
    return (await llm.run(system, `Products: ${products.join(", ")}\nDiet: vegetarian`)).trim().split("\n")[0]!.slice(0, 120);
  } catch (e) { return `LLM_ERROR: ${String(e)}`; }
}

const RECIPE_LINK = /\/rezepte\/\d+\/[^"'\s]+\.html/;
async function searchStatus(query: string): Promise<{ status: number; hasLink: boolean }> {
  try {
    const r = await fx("https://www.chefkoch.de/suche.php?suche=" + encodeURIComponent(query));
    const body = r.ok ? await r.text() : "";
    return { status: r.status, hasLink: RECIPE_LINK.test(body) };
  } catch { return { status: -1, hasLink: false }; }
}

async function waitForLive(): Promise<{ live: boolean; polls: number }> {
  for (let i = 1; i <= MAX_POLLS; i++) {
    const { status } = await searchStatus("Kartoffelsalat");
    console.error(`[liveness poll ${i}] status=${status}`);
    if (status === 200) return { live: true, polls: i };
    if (i < MAX_POLLS) await sleep(POLL_WAIT_MS);
  }
  return { live: false, polls: MAX_POLLS };
}

async function main() {
  // Baskets: food-only, simplest-named (least brand noise), realistic cross-category.
  const db = new Database(DB, { readonly: true });
  const rows = db.query(
    `SELECT d.name, d.taxonomy_category AS tax, d.dietary_tags AS tags FROM discount_items d`,
  ).all() as { name: string; tax: string | null; tags: string }[];
  db.close();
  const veg = rows.filter((r) => {
    let t: string[] = []; try { t = JSON.parse(r.tags); } catch {}
    return r.tax && !NON_FOOD_TAX.has(r.tax) && !t.includes("contains-meat") && !t.includes("contains-fish");
  });
  const byTax = new Map<string, string[]>();
  for (const r of veg) { if (!byTax.has(r.tax!)) byTax.set(r.tax!, []); byTax.get(r.tax!)!.push(r.name); }
  const simplest = new Map<string, string[]>();
  for (const [tax, names] of byTax)
    simplest.set(tax, names.slice().sort((a, b) => wordCount(a) - wordCount(b) || a.localeCompare(b)).slice(0, 8));
  const pick = (c: string, i: number) => simplest.get(c)?.[i];
  const combos: string[][] = [
    ["Produce", "Dairy & Cheese"], ["Dairy & Cheese", "Bakery"], ["Produce", "Pantry"],
    ["Pantry", "Dairy & Cheese"], ["Produce", "Dairy & Cheese", "Pantry"], ["Produce", "Bakery"],
    ["Pantry", "Produce"], ["Dairy & Cheese", "Produce"], ["Bakery", "Dairy & Cheese"],
    ["Produce", "Dairy & Cheese", "Bakery"],
  ];
  const baskets: { label: string; products: string[] }[] = [];
  combos.forEach((combo, i) => {
    const products = combo.map((c) => pick(c, i % 3)).filter((x): x is string => Boolean(x));
    if (products.length >= 2) baskets.push({ label: `${combo.join("+")}#${i % 3}`, products });
  });

  console.error(`veg food items=${veg.length}, baskets=${baskets.length}`);
  const live = await waitForLive();
  console.error(`liveness: ${live.live ? "LIVE" : "STILL BLOCKED"} after ${live.polls} poll(s)`);

  const source = new ChefkochRecipeSource(fx as typeof fetch);
  const results: unknown[] = [];
  let blocked = !live.live;

  for (const b of baskets) {
    if (blocked) { results.push({ ...b, skipped: "blocked_before_start" }); continue; }
    let query = await llmQuery(b.products);
    const refused = query === "SKIP" || query.startsWith("LLM_ERROR") || looksLikeRefusal(query);
    if (refused) {
      results.push({ ...b, query, refused: true, note: "refusal-sentinel: not searched" });
      console.error(`[skip] ${b.label} refused q="${query.slice(0, 50)}"`);
      continue;
    }
    let recipe = await source.find(query);
    let status = 200;
    if (!recipe) {
      const s = await searchStatus(query);
      status = s.status;
      if (status === 429) { // one backoff retry
        console.error(`[429] ${b.label} — backing off ${BACKOFF_MS / 1000}s`);
        await sleep(BACKOFF_MS);
        recipe = await source.find(query);
        if (!recipe) { const s2 = await searchStatus(query); status = s2.status; }
      }
    }
    if (status === 429) blocked = true; // stop hitting a re-tripped limit

    let lenient = 0, strict = 0, leaks: string[] = [], ings: string[] = [], name = "";
    if (recipe) {
      name = recipe.name; ings = recipe.ingredients; status = 200;
      for (const p of b.products) {
        if (ings.some((i) => tokensOverlap(p, i))) lenient++;
        if (strictUses(p, ings)) strict++;
      }
      leaks = dietaryLeaks(ings);
    }
    results.push({
      basket: b.label, products: b.products, query, refused: false,
      found: Boolean(recipe), status, recipeName: name, ingredientCount: ings.length,
      lenientUsed: lenient, strictUsed: strict, lenientGte1: lenient >= 1, lenientGte2: lenient >= 2,
      strictGte1: strict >= 1, strictGte2: strict >= 2,
      dietaryLeakCount: leaks.length, dietaryLeaks: leaks, ingredients: ings, // FULL list for false-neg audit
    });
    console.error(`[${status}] ${b.label} found=${Boolean(recipe)} lenU=${lenient} strU=${strict} leak=${leaks.length} "${name.slice(0, 40)}" q="${query.slice(0, 45)}"`);
    await sleep(SPACING_MS);
  }

  // Summary
  const searched = results.filter((r: any) => r.found !== undefined && !r.refused && r.skipped === undefined);
  const found = searched.filter((r: any) => r.found);
  const any429 = results.some((r: any) => r.status === 429) || blocked;
  const summary = {
    liveAfterPolls: live.polls, everBlockedDuringRun: any429,
    baskets: baskets.length, searched: searched.length, found: found.length,
    foundRate: searched.length ? +(found.length / searched.length).toFixed(2) : null,
    lenientGte1: found.filter((r: any) => r.lenientGte1).length,
    strictGte1: found.filter((r: any) => r.strictGte1).length,
    lenientGte2: found.filter((r: any) => r.lenientGte2).length,
    strictGte2: found.filter((r: any) => r.strictGte2).length,
    withDietaryLeak: found.filter((r: any) => r.dietaryLeakCount > 0).length,
  };
  await Bun.write(OUT, JSON.stringify({ summary, results }, null, 2));
  console.error("\nSUMMARY:", JSON.stringify(summary));
  console.error(`WROTE ${results.length} records to ${OUT}`);
}
main();
