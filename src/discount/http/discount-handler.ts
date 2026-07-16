/**
 * DiscountHandler — primary HTTP adapter for GET /
 *
 * Thin driving adapter: reads weekly discount items via DiscountService,
 * renders server-side HTML with item names, regular price ("was"), and sale price.
 *
 * When scrapeJobRepo is provided:
 *   - Shows staleness-warning for stores whose last completed run is > 48h ago
 *   - Shows per-store empty-state ("No discounts this week at {store}") for stores with 0 items
 *   - Falls back to global empty-state only when no scrape jobs exist at all
 *
 * When scrapeJobRepo is absent (legacy / unit-test path):
 *   - Falls back to prior behavior: global empty-state if no items
 *
 * No business logic here — filtering (D21) happens upstream in the service/repo layer.
 */

import type { DiscountService } from "../discount-service.ts";
import type { SQLiteScrapeJobRepository } from "../../scraping/adapters/sqlite-scrape-job-repository.ts";
import type { UserPreferencesRepository } from "../../preferences/ports/preferences-repository.ts";
import type { ShoppingListService } from "../../shopping-list/shopping-list-service.ts";
import { currentWeekMonday } from "../../shared/week.ts";
import { escapeHtml } from "../../shared/html.ts";
import { renderPage } from "../../shared/layout.ts";
import { TAXONOMY_CATEGORIES } from "../../shared/types.ts";

/**
 * Inline client-side feed controller (zero deps; htmx is not loaded on this page).
 *
 * ONE controller = the single source of truth for card visibility (store pill,
 * category pill, AND text search compose in applyFilters) plus a SEPARATE selection/overview controller
 * (highlight + cross-store overview + deselect). Progressive enhancement: without JS
 * nothing runs, so all cards/sections stay visible (only .no-match-state and the empty
 * overview list are server-rendered hidden/empty). Bound at DOMContentLoaded because
 * this <script> parses BEFORE #discount-items — a parse-time query sees an empty DOM.
 *
 * Written as a plain string constant to avoid backtick/${} collisions with the
 * surrounding TS template literals. The "All" pill uses the sentinel "__all__".
 */
const FILTER_SCRIPT = `
document.addEventListener('DOMContentLoaded', function () {
  var bar = document.querySelector('.filter-bar');
  if (!bar) return;
  var status = bar.querySelector('.filter-status');
  var searchInput = document.getElementById('feed-search-input');
  var noMatch = document.querySelector('.no-match-state');
  var overview = bar.querySelector('.selection-overview');
  var overviewList = document.getElementById('selection-overview-list');
  var overviewCount = bar.querySelector('.selection-overview-count');
  var overviewToggle = bar.querySelector('.selection-overview-toggle');
  var form = document.querySelector('.selection-form');
  var toast = document.querySelector('.feed-toast');
  var overviewAdd = bar.querySelector('.selection-overview-add');
  var overviewGenerate = bar.querySelector('.selection-overview-generate');
  var nativeAdd = document.querySelector('#meal-plan-action button[formaction="/list/add"]');

  var activeStore = '__all__';
  var activeCategory = '__all__';
  var query = '';
  var checkedCount = 0;
  var toastTimer = null;

  function applyFilters() {
    var groups = document.querySelectorAll('#discount-items .store-group[data-store]');
    var anyVisible = false;
    var totalCards = 0;
    for (var g = 0; g < groups.length; g++) {
      var section = groups[g];
      var sectionStore = section.getAttribute('data-store');
      var storeMatch = activeStore === '__all__' || sectionStore === activeStore;
      var cards = section.querySelectorAll('.card[data-item-card]');
      if (cards.length === 0) {
        // Empty-state section (no product cards): follows the pill ONLY, never derived-hiding.
        section.hidden = !storeMatch;
        continue;
      }
      totalCards += cards.length;
      var visibleInSection = 0;
      for (var c = 0; c < cards.length; c++) {
        var card = cards[c];
        var nameNode = card.querySelector('.item-name');
        var cardName = nameNode ? nameNode.textContent.toLowerCase() : '';
        var cardCategory = (card.getAttribute('data-category') || '').toLowerCase();
        var cardTags = (card.getAttribute('data-tags') || '');
        var textMatch = query === '' || cardName.indexOf(query) !== -1 || cardCategory.indexOf(query) !== -1 || cardTags.indexOf(query) !== -1;
        var categoryMatch = activeCategory === '__all__' || card.getAttribute('data-category') === activeCategory;
        var show = storeMatch && textMatch && categoryMatch;
        card.hidden = !show;
        if (show) { visibleInSection++; anyVisible = true; }
      }
      section.hidden = visibleInSection === 0;
    }
    // Show "No products match" ONLY when the feed HAS product cards but the active
    // store + category + search filter hid them all. A genuinely empty feed (0 cards) shows the
    // server-rendered empty-state instead — never both.
    if (noMatch) { noMatch.hidden = totalCards === 0 || anyVisible; }
  }

  // Category pill counts follow the active STORE facet only (not search, not the
  // active category): "how many <category> does this store have". Counts by store
  // membership from the DOM — cards hidden by the current filter still count.
  function updateCategoryCounts() {
    var pills = document.querySelectorAll('.category-filter-pills .filter-pill');
    for (var p = 0; p < pills.length; p++) {
      var pill = pills[p];
      var pillCategory = pill.getAttribute('data-category');
      var count = pill.querySelector('.pill-count');
      if (!count) continue;
      var cards = document.querySelectorAll('#discount-items .card[data-item-card]');
      var n = 0;
      for (var c = 0; c < cards.length; c++) {
        var card = cards[c];
        var group = card.closest('.store-group[data-store]');
        var cardStore = group ? group.getAttribute('data-store') : null;
        var storeMatch = activeStore === '__all__' || cardStore === activeStore;
        var categoryMatch = pillCategory === '__all__' || card.getAttribute('data-category') === pillCategory;
        if (storeMatch && categoryMatch) { n++; }
      }
      count.textContent = String(n);
    }
  }

  function refreshSelection() {
    var checkboxes = document.querySelectorAll('input[name="itemIds"]');
    checkedCount = 0;
    if (overviewList) { overviewList.textContent = ''; }
    for (var i = 0; i < checkboxes.length; i++) {
      var checkbox = checkboxes[i];
      var card = checkbox.closest('.card[data-item-card]');
      if (card) { card.classList.toggle('selected', checkbox.checked); }
      // CROSS-STORE: include EVERY checked checkbox regardless of card/section hidden.
      if (checkbox.checked) {
        checkedCount++;
        if (overviewList) {
          var nameNode = card ? card.querySelector('.item-name') : null;
          var productName = nameNode ? nameNode.textContent : '';
          var li = document.createElement('li');
          var entry = document.createElement('button');
          entry.type = 'button';
          entry.textContent = productName;
          entry.dataset.for = checkbox.id;
          li.appendChild(entry);
          overviewList.appendChild(li);
        }
      }
    }
    if (overviewCount) { overviewCount.textContent = 'Selected (' + checkedCount + ')'; }
    if (overviewAdd) { overviewAdd.disabled = checkedCount === 0; }
    if (overviewGenerate) { overviewGenerate.disabled = checkedCount === 0; }
  }

  function showToast(n) {
    if (!toast) return;
    if (toastTimer) { clearTimeout(toastTimer); }
    toast.textContent = 'Added ' + n + ' item(s) to your list';
    toast.hidden = false;
    toastTimer = setTimeout(function () {
      toast.hidden = true;
      toast.textContent = '';
      toastTimer = null;
    }, 3000);
  }

  // Live-update the List nav badge by the number of items just added. At true count 0
  // there is NO badge element in the server-rendered nav, so create-and-append it;
  // otherwise increment its text. (Server-side dedup may make this drift high by re-adds;
  // a reload/nav reconciles from the server-rendered count — KISS.)
  function bumpNavBadge(n) {
    var link = document.querySelector('a[href="/list"]');
    if (!link) return;
    var badge = link.querySelector('[data-nav-badge]');
    if (badge) {
      var current = parseInt(badge.textContent, 10) || 0;
      badge.textContent = String(current + n);
    } else {
      badge = document.createElement('span');
      badge.className = 'nav-badge';
      badge.setAttribute('data-nav-badge', '');
      badge.textContent = String(n);
      link.appendChild(badge);
    }
  }

  function addToList() {
    if (checkedCount === 0) return;
    if (!form) return;
    var n = checkedCount;
    var body = new URLSearchParams(new FormData(form));
    fetch('/list/add', {
      method: 'POST',
      headers: { 'X-Requested-With': 'fetch' },
      body: body,
    }).then(function (res) {
      if (res.ok) { showToast(n); bumpNavBadge(n); }
    });
  }

  bar.addEventListener('click', function (e) {
    var pill = e.target.closest('.filter-pill');
    if (!pill) return;
    // Toggle active state ONLY within the clicked pill's own group so the two
    // dimensions (store / category) stay independent — clicking a category pill
    // must not deselect the store pills, and vice-versa.
    var group = pill.closest('.filter-pills, .category-filter-pills');
    var groupPills = group ? group.querySelectorAll('.filter-pill') : [pill];
    for (var i = 0; i < groupPills.length; i++) {
      var active = groupPills[i] === pill;
      groupPills[i].classList.toggle('active', active);
      groupPills[i].setAttribute('aria-pressed', active ? 'true' : 'false');
      if (active) { groupPills[i].setAttribute('aria-current', 'true'); }
      else { groupPills[i].removeAttribute('aria-current'); }
    }
    // Route the selection to the RIGHT dimension: data-filter → store, data-category → category.
    var storeFilter = pill.getAttribute('data-filter');
    var categoryFilter = pill.getAttribute('data-category');
    if (storeFilter !== null) {
      activeStore = storeFilter;
      // Pill counts are per-store TOTALS (static) — never recomputed on search/filter.
      var label = storeFilter === '__all__' ? 'All' : storeFilter;
      var count = pill.querySelector('.pill-count');
      var n = count ? count.textContent : '';
      if (status) { status.textContent = 'Showing: ' + label + ' (' + n + ')'; }
      // Category pill counts follow the newly-selected store.
      updateCategoryCounts();
    } else if (categoryFilter !== null) {
      activeCategory = categoryFilter;
    }
    applyFilters();
  });

  if (searchInput) {
    searchInput.addEventListener('input', function () {
      query = searchInput.value.trim().toLowerCase();
      applyFilters();
    });
  }

  if (form) {
    form.addEventListener('change', function (e) {
      var target = e.target;
      if (target && target.name === 'itemIds') { refreshSelection(); }
    });
  }

  if (overviewList) {
    overviewList.addEventListener('click', function (e) {
      var entry = e.target.closest('button');
      if (!entry || !entry.dataset.for) return;
      var checkbox = document.getElementById(entry.dataset.for);
      if (!checkbox) return;
      checkbox.checked = false;
      // Reuse the single update path: dispatch change so the form handler runs refreshSelection.
      checkbox.dispatchEvent(new Event('change', { bubbles: true }));
    });
  }

  if (overviewToggle && overview) {
    overviewToggle.addEventListener('click', function () {
      var expanded = overview.classList.toggle('expanded');
      overviewToggle.setAttribute('aria-expanded', expanded ? 'true' : 'false');
    });
  }

  // Entry point 1: intercept the native "Add to Shopping List" submit → async add.
  // Hide it once enhanced so it isn't duplicated (it stays in the no-JS DOM).
  if (nativeAdd) {
    nativeAdd.addEventListener('click', function (e) {
      e.preventDefault();
      addToList();
    });
    nativeAdd.hidden = true;
  }

  // Entry point 2: overview "Add to Shopping List" action → async add.
  if (overviewAdd) {
    overviewAdd.addEventListener('click', function () { addToList(); });
  }

  // Entry point 3: overview "Generate Meal Plan" action. The overview lives OUTSIDE
  // the selection form, so requestSubmit() (no submitter) posts the form's default
  // action (/plan/generate) → normal navigation to /plan.
  if (overviewGenerate && form) {
    overviewGenerate.addEventListener('click', function () {
      if (checkedCount === 0) return;
      form.requestSubmit();
    });
  }

  refreshSelection();
  updateCategoryCounts();
  applyFilters();
});
`;

const STALENESS_THRESHOLD_HOURS = 48;
const STALENESS_THRESHOLD_MS = STALENESS_THRESHOLD_HOURS * 60 * 60 * 1000;
const DATE_LOCALE = "de-DE";

/** Staleness predicate: returns true if the last run was more than 48 hours ago. */
export function isStale(completedAt: number, now: number): boolean {
  return now - completedAt > STALENESS_THRESHOLD_MS;
}

function centsToEuros(cents: number): string {
  return (cents / 100).toFixed(2);
}

/** Whole-number discount percentage (regular vs sale). Guards a zero/absent regular price. */
function discountPercent(regularPrice: number, salePrice: number): number {
  if (regularPrice <= 0 || salePrice >= regularPrice) return 0;
  return Math.round(((regularPrice - salePrice) / regularPrice) * 100);
}

export class DiscountHandler {
  constructor(
    private readonly discountService: DiscountService,
    private readonly scrapeJobRepo?: SQLiteScrapeJobRepository,
    private readonly preferencesRepo?: UserPreferencesRepository,
    // Optional trailing param (mirrors the existing scrapeJobRepo/preferencesRepo precedent):
    // preserves direct-construction call sites in tests. Production injects it for the nav badge.
    private readonly shoppingListService?: ShoppingListService,
  ) {}

  async handleGet(_request: Request): Promise<Response> {
    const weekStart = currentWeekMonday();
    // LIVE read on every request — the feed re-filters the moment the setting changes.
    const restriction = this.preferencesRepo?.get().dietaryRestriction ?? "none";
    const items = await this.discountService.getWeeklyItems(weekStart, restriction);
    const knownStores = this.scrapeJobRepo?.getStoresWithJobs() ?? [];

    // Single source of truth: group items ONCE, then derive BOTH the filter pills
    // and the rendered sections from the same grouping (no divergent recount).
    const storeItems = this.groupItemsByStore(items);

    const itemsHtml = knownStores.length === 0
      ? this.renderFallback(items)
      : this.renderWithStoreContext(items, knownStores, storeItems);

    const filterBar = this.renderFilterBar(items, storeItems);

    const body = `<header>
    <h1>Weekly Discount Feed</h1>
  </header>
  ${filterBar}
  <form class="selection-form" method="POST" action="/plan/generate">
    <section id="discount-items">
      ${itemsHtml}
      <p class="no-match-state" hidden>No products match</p>
    </section>
    <section id="meal-plan-action">
      <button type="submit" id="generate-meal-plan">Generate Meal Plan</button>
      <button type="submit" formaction="/list/add">Add to Shopping List</button>
    </section>
  </form>
  <div class="feed-toast" role="status" aria-live="polite" hidden></div>`;

    const html = renderPage({
      title: "Discount Hunt — Weekly Deals",
      activeNav: "feed",
      body,
      listCount: this.shoppingListService?.count() ?? 0,
    });

    return new Response(html, {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }

  private renderFallback(items: Awaited<ReturnType<DiscountService["getWeeklyItems"]>>): string {
    if (items.length === 0) {
      return `<p class="empty-state"><span class="state-illustration" aria-hidden="true">🛒</span>No discounts available this week</p>`;
    }
    return this.renderItemsByStore(items);
  }

  /**
   * Filter bar (progressive enhancement): an "All" pill with the TOTAL count plus one
   * pill per store that has ≥1 item, each with that store's count — derived from the SAME
   * grouping the sections use. Pills are <button>s (keyboard-accessible, ≥44px via CSS).
   * Default active = All. Without JS, all sections stay visible and the bar is inert (the
   * inline script below is the only thing that hides sections).
   */
  private renderFilterBar(
    items: Awaited<ReturnType<DiscountService["getWeeklyItems"]>>,
    storeItems: Map<string, Awaited<ReturnType<DiscountService["getWeeklyItems"]>>>,
  ): string {
    const total = items.length;
    const allPill =
      `<button type="button" class="filter-pill active" data-filter="__all__" aria-pressed="true" aria-current="true">All <span class="pill-count">${total}</span></button>`;
    const storePills = Array.from(storeItems.entries())
      .filter(([, group]) => group.length > 0)
      .map(([store, group]) => {
        const safeStore = escapeHtml(store);
        return `<button type="button" class="filter-pill" data-filter="${safeStore}" aria-pressed="false">${safeStore} <span class="pill-count">${group.length}</span></button>`;
      })
      .join("\n      ");

    const categoryPills = this.renderCategoryPills(items, total);

    return `<nav class="filter-bar" aria-label="Filter deals by store and category">
    <div class="filter-bar-row">
      <div class="filter-pills" role="group">
        ${allPill}
        ${storePills}
      </div>
      <section class="selection-overview" aria-label="Selected products">
        <button type="button" class="selection-overview-toggle" aria-expanded="false" aria-controls="selection-overview-list">
          <span class="selection-overview-count" aria-live="polite">Selected (0)</span>
        </button>
        <ul id="selection-overview-list" class="selection-overview-list"></ul>
        <div class="selection-overview-actions">
          <button type="button" class="selection-overview-add" disabled>Add to Shopping List</button>
          <button type="button" class="selection-overview-generate" disabled>Generate Meal Plan</button>
        </div>
      </section>
    </div>
    <div class="category-filter-pills" role="group" aria-label="Filter deals by category">
      ${categoryPills}
    </div>
    <p class="filter-status" aria-live="polite">Showing: All (${total})</p>
    <div class="feed-search">
      <label for="feed-search-input" class="feed-search-label">Search products</label>
      <input type="search" id="feed-search-input" class="feed-search-input" placeholder="Search products…" autocomplete="off">
    </div>
  </nav>
  <script>${FILTER_SCRIPT}</script>`;
  }

  /**
   * Category pill group (3rd additive filter dimension). "All" pill (sentinel __all__,
   * total count) + one pill per category PRESENT in the feed, in TAXONOMY_CATEGORIES
   * canonical order (the SSOT — never re-list the literals). NULL/pending taxonomy is
   * tallied under "Other". Only categories with ≥1 item emit a pill. Category pills use
   * data-category (store pills use data-filter) so the client keys the right dimension.
   */
  private renderCategoryPills(
    items: Awaited<ReturnType<DiscountService["getWeeklyItems"]>>,
    total: number,
  ): string {
    const counts = new Map<string, number>();
    for (const item of items) {
      const cat = item.taxonomyCategory ?? "Other";
      counts.set(cat, (counts.get(cat) ?? 0) + 1);
    }
    const allPill =
      `<button type="button" class="filter-pill active" data-category="__all__" aria-pressed="true" aria-current="true">All <span class="pill-count">${total}</span></button>`;
    const catPills = TAXONOMY_CATEGORIES
      .filter((cat) => (counts.get(cat) ?? 0) > 0)
      .map((cat) => {
        const safeCat = escapeHtml(cat);
        return `<button type="button" class="filter-pill" data-category="${safeCat}" aria-pressed="false">${safeCat} <span class="pill-count">${counts.get(cat)}</span></button>`;
      })
      .join("\n      ");
    return `${allPill}
      ${catPills}`;
  }

  private renderWithStoreContext(
    items: Awaited<ReturnType<DiscountService["getWeeklyItems"]>>,
    knownStores: string[],
    storeItems: Map<string, Awaited<ReturnType<DiscountService["getWeeklyItems"]>>>,
  ): string {
    const now = Date.now();
    const warnings = this.buildStalenessWarnings(knownStores, now);
    const sections = this.buildStoreSections(knownStores, storeItems);

    // Render items for stores not in knownStores (edge case: items from unknown stores)
    for (const [store, group] of storeItems.entries()) {
      if (!knownStores.includes(store)) {
        sections.push(this.renderStoreSection(store, group));
      }
    }

    return [...warnings, ...sections].join("\n");
  }

  private groupItemsByStore(
    items: Awaited<ReturnType<DiscountService["getWeeklyItems"]>>,
  ): Map<string, Awaited<ReturnType<DiscountService["getWeeklyItems"]>>> {
    const storeItems = new Map<string, typeof items>();
    for (const item of items) {
      const group = storeItems.get(item.store) ?? [];
      group.push(item);
      storeItems.set(item.store, group);
    }
    return storeItems;
  }

  private buildStalenessWarnings(knownStores: string[], now: number): string[] {
    const warnings: string[] = [];
    for (const store of knownStores) {
      const completedAt = this.scrapeJobRepo!.getLastSuccessfulRunByStore(store);
      if (completedAt !== null && isStale(completedAt, now)) {
        const lastRefreshed = new Date(completedAt).toLocaleDateString(DATE_LOCALE);
        warnings.push(
          `<div class="staleness-warning">Data for ${escapeHtml(store)} may be outdated — last refreshed ${lastRefreshed}</div>`,
        );
      }
    }
    return warnings;
  }

  private buildStoreSections(
    knownStores: string[],
    storeItems: Map<string, Awaited<ReturnType<DiscountService["getWeeklyItems"]>>>,
  ): string[] {
    const sections: string[] = [];
    for (const store of knownStores) {
      const storeGroup = storeItems.get(store) ?? [];
      if (storeGroup.length === 0) {
        const safeStore = escapeHtml(store);
        sections.push(
          `<section class="store-group" data-store="${safeStore}">
      <h2 class="store-name">${safeStore}</h2>
      <p class="empty-state">No discounts this week at ${safeStore}</p>
    </section>`,
        );
      } else {
        sections.push(this.renderStoreSection(store, storeGroup));
      }
    }
    return sections;
  }

  private renderItemsByStore(items: Awaited<ReturnType<DiscountService["getWeeklyItems"]>>): string {
    const byStore = new Map<string, typeof items>();
    for (const item of items) {
      const group = byStore.get(item.store) ?? [];
      group.push(item);
      byStore.set(item.store, group);
    }
    return Array.from(byStore.entries())
      .map(([storeName, storeItems]) => this.renderStoreSection(storeName, storeItems))
      .join("\n");
  }

  private renderStoreSection(
    storeName: string,
    storeItems: Awaited<ReturnType<DiscountService["getWeeklyItems"]>>,
  ): string {
    // DEFAULT ORDER: cheapest first. Stable sort on a COPY — the passed array is the
    // same grouping used for pill counts, so it must not be mutated in place.
    const sorted = [...storeItems].sort((a, b) => a.salePrice - b.salePrice);
    const storeItemsHtml = sorted
      .map((item) => {
        const pct = discountPercent(item.regularPrice, item.salePrice);
        const badge = pct > 0
          ? `<span class="savings-badge" aria-label="save ${pct} percent">−${pct}%</span>`
          : "";
        // Selection checkbox — UNCHECKED by default: nothing is preselected, so Generate
        // hits the server-side no-selection guard until the user opts items in. The <label>
        // (associated via for/id) toggles it; a ≥44px tap target comes from CSS. The
        // checkbox is independent of the filter: the filter JS only sets .hidden on
        // sections, so a hidden card's checkbox STILL submits when checked.
        const inputId = `select-${escapeHtml(item.id)}`;
        const selection = `<label class="card-select" for="${inputId}">
          <input type="checkbox" id="${inputId}" name="itemIds" value="${escapeHtml(item.id)}">
          <span class="card-select-text">Include</span>
        </label>`;
        // NULL/pending taxonomy → the "Other" bucket. Escaped: 3 canonical categories
        // contain "&" (e.g. "Meat & Fish") → data-category="Meat &amp; Fish".
        const category = escapeHtml(item.taxonomyCategory ?? "Other");
        // Cross-cutting tags: data-tags is lowercased + space-joined for client search
        // (read as an attribute, NEVER from chip text). Chips display ORIGINAL casing and
        // sit OUTSIDE .item-name so the search / selection-overview read a clean product name.
        const tags = item.tags ?? [];
        const dataTags = escapeHtml(tags.map((t) => t.toLowerCase()).join(" "));
        const tagChips = tags.length > 0
          ? `<div class="card-tags">${tags.map((t) => `<span class="card-tag">${escapeHtml(t)}</span>`).join("")}</div>`
          : "";
        // In-card store chip (Feature A): the section param IS the store for this group.
        // Sits at article top, OUTSIDE .item-name so it never pollutes the searchable name.
        const storeChip = `<span class="card-store">${escapeHtml(storeName)}</span>`;
        // Feed name → original offer link (Feature B). Link ONLY for genuine http(s) URLs;
        // any other value (null, javascript:, ftp:) renders plain text. The anchor is the
        // ONLY child of .item-name and its text is EXACTLY the product name — no affordance
        // text in the DOM (the affordance "↗" is a CSS ::after on .item-name a). This keeps
        // querySelector('.item-name').textContent === product name for search + selection.
        const url = item.sourceUrl;
        const isLinkable = url !== null && (url.startsWith("http://") || url.startsWith("https://"));
        const itemName = isLinkable
          ? `<h3 class="item-name"><a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(item.name)}</a></h3>`
          : `<h3 class="item-name">${escapeHtml(item.name)}</h3>`;
        return `
      <div class="card" data-item-card data-category="${category}" data-tags="${dataTags}">
        ${badge}
        ${selection}
        <article class="discount-item">
        ${storeChip}
        ${itemName}
        <p class="item-price">
          <span class="was-price">was €${centsToEuros(item.regularPrice)}</span>
          <span class="sale-price">€${centsToEuros(item.salePrice)}</span>
        </p>
        ${tagChips}
      </article>
      </div>`;
      })
      .join("\n");
    return `<section class="store-group" data-store="${escapeHtml(storeName)}">
      <h2 class="store-name">${escapeHtml(storeName)}</h2>
      <div class="card-grid">
      ${storeItemsHtml}
      </div>
    </section>`;
  }
}
