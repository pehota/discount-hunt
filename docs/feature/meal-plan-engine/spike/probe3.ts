/**
 * SPIKE-00 RUN 3 — clean, slow coverage measurement after run-2 hit HTTP 429.
 * 120s cooldown, then 6 curated (basket, strong dish-query) pairs 18s apart, so
 * rate-limiting doesn't confound the CORE question: do good queries return real
 * recipes that use >=2 basket products, dietary-safe? Distinguishes 429 from
 * genuine no-recipe. Reuses real seams; not production code.
 */
import { ChefkochRecipeSource } from "/home/mitko/Work/discount-hunt/src/recipe/adapters/chefkoch-recipe-source.ts";
import { tokensOverlap } from "/home/mitko/Work/discount-hunt/src/recipe/ingredient-match.ts";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const OUT = "/home/mitko/Work/discount-hunt/docs/feature/meal-plan-engine/spike/raw-results-3.json";
const MEAT_FISH = ["fleisch","hähnch","huhn","pute","rind","schwein","hack","speck","schinken","wurst","salami","bacon","lamm","ente","kalb","steak","geflügel","leber","fisch","lachs","thunfisch","garnele","shrimp","krabbe","forelle","hering","sardell","sardine","kabeljau","muschel","scampi","hummer","makrele","salmon","tuna"];
const sleep = (ms:number)=>new Promise(r=>setTimeout(r,ms));
const fx = (u:string)=>fetch(u,{headers:{"User-Agent":UA},signal:AbortSignal.timeout(15000)});
const leak=(ings:string[])=>ings.filter(i=>MEAT_FISH.some(m=>i.toLowerCase().includes(m)));

// Curated realistic 2-ingredient veg baskets from the real DB + a strong dish query each.
const pairs = [
  { products:["Bio-Zitronen","Barilla Pasta"], query:"Zitronenpasta Rezept" },
  { products:["Emmentaler","Dinkel-Vollkornbrot"], query:"überbackenes Käsebrot Emmentaler Rezept" },
  { products:["Back-Camembert","Bio-Steinofen-Sauerteigkruste"], query:"gebackener Camembert Brot Rezept" },
  { products:["Bio-Mini-Wassermelone","Hirtenkäse"], query:"Wassermelone Feta Salat Rezept" },
  { products:["Brokkoli","Emmentaler"], query:"Brokkoli Auflauf Käse Rezept" },
  { products:["Eisbergsalat","Bio-Zitronen"], query:"Eisbergsalat Zitronendressing Rezept" },
];

async function main(){
  console.error("cooldown 120s for the 429 to clear...");
  await sleep(120000);
  const source = new ChefkochRecipeSource(fx as typeof fetch);
  const results:unknown[]=[];
  for (const p of pairs){
    const recipe = await source.find(p.query);
    let status=200, found=false, name="", ing:string[]=[], lenient=0, strict=0;
    if (recipe){ found=true; name=recipe.name; ing=recipe.ingredients;
      for (const prod of p.products){ if (ing.some(i=>tokensOverlap(prod,i))) lenient++; }
      const toks=(s:string)=>new Set(s.toLowerCase().split(/[^a-zäöüß0-9]+/i).filter(t=>t.length>=4));
      for (const prod of p.products){ const pt=toks(prod); if (ing.some(i=>{for(const t of toks(i))if(pt.has(t))return true;return false;})) strict++; }
    } else {
      // classify failure: raw search status
      try { const r = await fx("https://www.chefkoch.de/suche.php?suche="+encodeURIComponent(p.query)); status=r.status; } catch { status=-1; }
    }
    const ls = found? leak(ing):[];
    results.push({ ...p, found, status, recipeName:name, ingredientCount:ing.length, lenientUsed:lenient, strictUsed:strict, lenientGte2:lenient>=2, strictGte2:strict>=2, dietaryLeakCount:ls.length, dietaryLeaks:ls, ingredients: found? ing : [] });
    console.error(`found=${found} status=${status} lenU=${lenient} strU=${strict} leak=${ls.length} "${name.slice(0,45)}" q="${p.query}"`);
    await sleep(18000);
  }
  await Bun.write(OUT, JSON.stringify({results},null,2));
  console.error(`\nWROTE ${results.length} to ${OUT}`);
}
main();
