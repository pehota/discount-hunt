/**
 * Shared Kernel — page layout shell.
 *
 * renderPage({ title, activeNav, body }) wraps caller-supplied inner-body markup
 * in a full HTML document: doctype, <head> (charset, viewport, escaped <title>),
 * an inline <style> implementing a clean utility theme (light bg, system-ui font,
 * max-width container, a top .site-nav bar with the brand + five route links, a
 * responsive .card-grid, and basic table/banner styling), and a top nav with the
 * active page marked.
 *
 * Contract shape: pure-function / return-only. The body string is NEVER transformed
 * — callers pass ready-to-render HTML and every asserted marker/attribute inside it
 * survives verbatim. Only the title is escaped (untrusted-safe by default).
 */

import { escapeHtml } from "./html.ts";

export type NavKey = "feed" | "plan" | "savings" | "list" | "settings";

export interface PageOptions {
  readonly title: string;
  readonly activeNav: NavKey;
  readonly body: string;
}

const NAV_ITEMS: ReadonlyArray<{ key: NavKey; href: string; label: string; icon: string }> = [
  { key: "feed", href: "/", label: "Feed", icon: "🛒" },
  { key: "plan", href: "/plan", label: "Plan", icon: "📋" },
  { key: "savings", href: "/savings", label: "Savings", icon: "💰" },
  { key: "list", href: "/list", label: "List", icon: "🧾" },
  { key: "settings", href: "/settings", label: "Settings", icon: "⚙️" },
];

const STYLE = `
    :root {
      /* Colors — existing tokens preserved */
      --bg: #f5f6f8;
      --surface: #ffffff;
      --border: #e2e5ea;
      --text: #1f2733;
      --muted: #5b6472;
      --accent: #2f6f4f;      /* brand green */
      --sale: #c0392b;        /* sale red */
      --warning-bg: #fff4e5;
      --warning-border: #f0c27b;
      /* Added tokens (Fresh Market) */
      --save: #157347;        /* savings green — the payoff color */
      --accent-soft: #e8f3ec; /* soft accent background for hero cards */
      --save-soft: #e6f4ea;   /* soft savings background */
      /* Spacing scale */
      --sp-1: 0.25rem; --sp-2: 0.5rem; --sp-3: 0.75rem;
      --sp-4: 1rem; --sp-5: 1.5rem; --sp-6: 2rem;
      /* Radius scale */
      --r-sm: 8px; --r-md: 12px; --r-lg: 16px;
      /* Shadows */
      --shadow-sm: 0 1px 2px rgba(16, 24, 40, 0.06);
      --shadow-md: 0 4px 14px rgba(16, 24, 40, 0.10);
      /* Type scale */
      --fs-sm: 0.85rem; --fs-base: 1rem; --fs-lg: 1.25rem;
      --fs-xl: 1.6rem; --fs-hero: 2.75rem;
      /* Layout */
      --tap: 44px;                 /* min tap target */
      --tabbar-h: 4rem;            /* mobile bottom tab bar height (>=56px) */
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
      background: var(--bg);
      color: var(--text);
      line-height: 1.5;
    }
    :focus-visible {
      outline: 3px solid var(--accent);
      outline-offset: 2px;
      border-radius: var(--r-sm);
    }

    /* ── Navigation ───────────────────────────────────────────────────────
       Single .site-nav element, restyled per breakpoint.
       Mobile (<768px): fixed bottom tab bar (default styles below).
       Desktop (>=768px): top sticky bar (media query at the end). */
    .site-nav {
      position: fixed;
      bottom: 0;
      left: 0;
      right: 0;
      z-index: 100;
      display: flex;
      align-items: stretch;
      background: var(--surface);
      border-top: 1px solid var(--border);
      box-shadow: 0 -1px 4px rgba(16, 24, 40, 0.06);
      padding: 0;
      padding-bottom: env(safe-area-inset-bottom, 0);
    }
    .site-nav .brand {
      display: none;          /* hidden on mobile — reappears in the desktop bar */
      font-weight: 700;
      font-size: var(--fs-lg);
      color: var(--accent);
    }
    .site-nav a {
      flex: 1 1 0;
      min-width: 0;
      min-height: 56px;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 2px;
      padding: var(--sp-1);
      text-decoration: none;
      color: var(--muted);
      font-size: var(--fs-sm);
    }
    .site-nav a .nav-icon { font-size: 1.35rem; line-height: 1; }
    .site-nav a.active {
      color: var(--accent);
      font-weight: 600;
    }
    .site-nav a.active .nav-icon { transform: translateY(-1px); }

    /* ── Layout container ─────────────────────────────────────────────────
       Bottom padding clears the fixed mobile tab bar. */
    .container {
      max-width: 960px;
      margin: 0 auto;
      padding: var(--sp-4);
      padding-bottom: calc(var(--tabbar-h) + var(--sp-5));
    }
    h1 { font-size: var(--fs-xl); margin: 0 0 var(--sp-4); }
    h2 { font-size: var(--fs-lg); }

    /* ── Store filter bar (feed) ──────────────────────────────────────────
       In-flow sticky element under the <h1> (NOT the bottom-tab .site-nav).
       CRITICAL: the BAR scrolls horizontally itself — it must never push page
       h-overflow at 375px. overflow-x:auto + flex nowrap + non-shrinking pills
       keep any spill inside the bar; opaque bg so scrolled content doesn't bleed
       through the sticky bar. */
    .filter-bar {
      position: sticky;
      top: 0;
      z-index: 50;
      background: var(--bg);
      margin: 0 0 var(--sp-4);
      padding: var(--sp-2) 0;
    }
    .filter-pills {
      display: flex;
      flex-wrap: nowrap;
      gap: var(--sp-2);
      overflow-x: auto;
      -webkit-overflow-scrolling: touch;
      scrollbar-width: none;               /* hide scrollbar chrome (Firefox) */
      padding-bottom: var(--sp-1);         /* room for momentum-scroll shadow */
    }
    .filter-pills::-webkit-scrollbar { display: none; }
    .filter-pill {
      flex: 0 0 auto;                      /* never shrink → bar scrolls, page doesn't */
      display: inline-flex;
      align-items: center;
      gap: var(--sp-2);
      min-height: var(--tap);              /* >=44px tap target */
      width: auto;                         /* override global button width:100% */
      margin: 0;
      padding: var(--sp-2) var(--sp-4);
      background: var(--surface);
      color: var(--text);
      border: 1px solid var(--border);
      border-radius: 999px;
      font-size: var(--fs-sm);
      font-weight: 600;
      white-space: nowrap;
      cursor: pointer;
    }
    .filter-pill .pill-count {
      background: var(--border);
      color: var(--muted);
      border-radius: 999px;
      padding: 0 var(--sp-2);
      font-size: var(--fs-sm);
    }
    .filter-pill.active {
      background: var(--accent);
      color: #fff;
      border-color: var(--accent);
    }
    .filter-pill.active .pill-count {
      background: rgba(255, 255, 255, 0.25);
      color: #fff;
    }
    .filter-status {
      margin: var(--sp-2) 0 0;
      color: var(--muted);
      font-size: var(--fs-sm);
    }

    /* ── Feed search (feed) ───────────────────────────────────────────────
       Lives inside the .filter-bar <nav> (NOT the selection <form>), so the
       global form { max-width:460px } clamp does not apply. It still inherits
       the global input { width:100% } — its container is full-bleed on mobile,
       constrained on desktop below. */
    .feed-search { margin-top: var(--sp-2); }
    .feed-search-label {
      display: block;
      margin-bottom: var(--sp-1);
      color: var(--muted);
      font-weight: 600;
      font-size: var(--fs-sm);
    }
    .feed-search-input {
      width: 100%;
      min-height: var(--tap);              /* >=44px tap target */
      padding: var(--sp-2) var(--sp-3);
      border: 1px solid var(--border);
      border-radius: var(--r-sm);
      font-size: var(--fs-base);
      background: var(--surface);
      color: var(--text);
    }

    /* ── Selection overview (feed) ────────────────────────────────────────
       ONE DOM node; a fixed-height "Selected (N)" toggle whose list opens as an
       ABSOLUTELY-POSITIONED overlay (dropdown) on BOTH breakpoints. Because the
       list is out of flow, the overview's in-flow footprint is always just the
       toggle height — opening/closing or adding/removing items NEVER reflows the
       pills, "Showing:" status, or search input. Default closed (matches the
       markup's aria-expanded="false"). The list scrolls internally and items wrap
       → never causes 375px PAGE h-overflow. */
    .selection-overview { position: relative; margin-top: var(--sp-2); }
    .selection-overview-toggle {
      /* Override the global primary button: a lighter, full-width summary row. */
      width: 100%;
      min-height: var(--tap);
      text-align: left;
      background: var(--surface);
      color: var(--text);
      border: 1px solid var(--border);
      border-radius: var(--r-sm);
      padding: var(--sp-2) var(--sp-3);
      font-size: var(--fs-sm);
      font-weight: 600;
      cursor: pointer;
    }
    .selection-overview-count { color: var(--text); }
    .selection-overview-list {
      list-style: none;
      padding: 0;
      margin: 0;
      display: none;                       /* closed by default (both breakpoints) */
      /* Absolute overlay under the toggle: floats OVER the content below so its
         size never changes the flow footprint. Opaque bg + border + shadow + z-index
         so card text below never bleeds through; left/right:0 (full parent width) =
         no horizontal spill at 375px. */
      position: absolute;
      top: 100%;
      left: 0;
      right: 0;
      z-index: 60;
      margin-top: var(--sp-1);
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--r-sm);
      box-shadow: var(--shadow-md);
      padding: var(--sp-2);
      max-height: 40vh;
      overflow-y: auto;
    }
    .selection-overview.expanded .selection-overview-list { display: block; }
    .selection-overview-list li { margin: 0 0 var(--sp-1); }
    .selection-overview-list li button {
      /* Override the global primary button: light, left-aligned, wrapping entry. */
      width: 100%;
      text-align: left;
      white-space: normal;                 /* wrap long product names */
      overflow-wrap: anywhere;
      background: var(--surface);
      color: var(--text);
      border: 1px solid var(--border);
      border-radius: var(--r-sm);
      padding: var(--sp-2) var(--sp-3);
      min-height: var(--tap);
      font-size: var(--fs-sm);
      font-weight: 500;
      cursor: pointer;
    }

    /* Overview action buttons (add-to-list / generate) — sit under the deselect list
       inside the dropdown overlay. Reuse the light overview-entry look. */
    .selection-overview-actions {
      display: grid;
      gap: var(--sp-2);
      margin-top: var(--sp-2);
    }
    .selection-overview-actions button {
      width: 100%;
      min-height: var(--tap);
      font-size: var(--fs-sm);
      font-weight: 600;
    }
    .selection-overview-add {
      background: var(--accent);
      color: #fff;
      border: none;
      border-radius: var(--r-sm);
    }
    .selection-overview-generate {
      background: var(--surface);
      color: var(--accent);
      border: 1px solid var(--accent);
      border-radius: var(--r-sm);
    }
    .selection-overview-actions button:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    /* ── Feed toast (live region) ─────────────────────────────────────────
       Fixed above the mobile tab bar, inset left/right so it can NEVER cause
       375px horizontal overflow. z-index above the overview dropdown (60) and
       nav (100). Hidden when [hidden]. Desktop centers with a max-width. */
    .feed-toast {
      position: fixed;
      bottom: calc(var(--tabbar-h) + var(--sp-3));
      left: var(--sp-4);
      right: var(--sp-4);
      z-index: 200;
      background: var(--accent);
      color: #fff;
      border-radius: var(--r-md);
      box-shadow: var(--shadow-md);
      padding: var(--sp-3) var(--sp-4);
      font-weight: 600;
      font-size: var(--fs-sm);
      text-align: center;
    }
    .feed-toast[hidden] { display: none; }

    /* No-match empty state (toggled by the client controller). */
    .no-match-state {
      text-align: center;
      color: var(--muted);
      padding: var(--sp-4);
    }

    /* ── Store section header ─────────────────────────────────────────────*/
    .store-group { margin-bottom: var(--sp-5); }
    .store-name {
      display: inline-block;
      margin: 0 0 var(--sp-3);
      padding: var(--sp-1) var(--sp-3);
      background: var(--accent-soft);
      color: var(--accent);
      border-radius: 999px;
      font-size: var(--fs-base);
    }

    /* ── Cards / feed ─────────────────────────────────────────────────────*/
    .card-grid {
      display: grid;
      grid-template-columns: 1fr;   /* 1 column on mobile */
      gap: var(--sp-3);
    }
    .card {
      position: relative;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--r-md);
      padding: var(--sp-3) var(--sp-4);
      box-shadow: var(--shadow-sm);
    }
    /* Selected card highlight (client controller toggles .selected). */
    .card.selected { border-color: var(--accent); background: var(--accent-soft); }
    .card .item-name { margin: 0 0 var(--sp-2); font-size: var(--fs-base); padding-right: 4.5rem; }
    .was-price { color: var(--muted); text-decoration: line-through; margin-right: var(--sp-2); }
    .sale-price { color: var(--sale); font-weight: 700; font-size: var(--fs-lg); }
    /* Savings badge (feed) — corner chip using --save */
    .savings-badge {
      position: absolute;
      top: var(--sp-3);
      right: var(--sp-3);
      background: var(--save-soft);
      color: var(--save);
      font-weight: 700;
      font-size: var(--fs-sm);
      padding: var(--sp-1) var(--sp-2);
      border-radius: 999px;
      white-space: nowrap;
    }

    /* ── Savings hero (savings + plan) ────────────────────────────────────*/
    .savings-hero {
      background: var(--save-soft);
      border: 1px solid #a3d9b1;
      border-radius: var(--r-lg);
      padding: var(--sp-5);
      margin: 0 0 var(--sp-5);
      box-shadow: var(--shadow-sm);
      text-align: center;
    }
    .savings-hero .hero-label {
      margin: 0;
      color: var(--save);
      font-size: var(--fs-sm);
      text-transform: uppercase;
      letter-spacing: 0.05em;
      font-weight: 600;
    }
    .savings-hero .hero-amount {
      display: block;
      color: var(--save);
      font-size: var(--fs-hero);
      font-weight: 800;
      line-height: 1.1;
      margin: var(--sp-1) 0;
    }
    .savings-hero .hero-sub { margin: 0; color: var(--muted); font-size: var(--fs-sm); }
    .savings-hero .hero-pct {
      display: inline-block;
      margin-top: var(--sp-2);
      background: var(--save);
      color: #fff;
      font-weight: 700;
      font-size: var(--fs-sm);
      padding: var(--sp-1) var(--sp-3);
      border-radius: 999px;
    }
    /* Compact plan hero strip */
    .plan-hero { display: flex; align-items: baseline; justify-content: center; gap: var(--sp-3); flex-wrap: wrap; }
    .plan-hero .hero-amount { font-size: var(--fs-xl); margin: 0; }

    .secondary-stat {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--r-md);
      padding: var(--sp-3) var(--sp-4);
      margin: 0 0 var(--sp-5);
      box-shadow: var(--shadow-sm);
    }

    /* ── Tables → reflow to cards on mobile ───────────────────────────────
       Keep the single <table> DOM; on mobile each <tr> renders as a card.
       Desktop restores real table layout in the media query. */
    table { width: 100%; border-collapse: collapse; }
    table thead { display: none; }        /* hidden on mobile; shown on desktop */
    table tr {
      display: block;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--r-md);
      box-shadow: var(--shadow-sm);
      padding: var(--sp-2) var(--sp-3);
      margin-bottom: var(--sp-3);
    }
    table td {
      display: block;
      border: none;
      padding: var(--sp-1) 0;
      text-align: left;
    }
    /* Reflowed cards: surface the column name from data-label so stacked cells stay legible. */
    table td[data-label]::before {
      content: attr(data-label) ": ";
      color: var(--muted);
      font-weight: 600;
      font-size: var(--fs-sm);
      margin-right: var(--sp-1);
    }
    table td .sale-price { font-size: var(--fs-base); }

    /* ── Warnings / banners ───────────────────────────────────────────────*/
    .staleness-warning, .over-budget-warning, .empty-plan-warning,
    .no-discounts-warning, .empty-state, .settings-saved {
      background: var(--warning-bg);
      border: 1px solid var(--warning-border);
      border-radius: var(--r-sm);
      padding: var(--sp-3) var(--sp-4);
      margin: var(--sp-2) 0;
    }
    .settings-saved { background: var(--save-soft); border-color: #a3d9b1; }

    /* ── Empty state (friendly) ───────────────────────────────────────────*/
    .empty-state { text-align: center; }
    .state-illustration { font-size: 2.5rem; display: block; margin-bottom: var(--sp-2); }

    /* ── Forms ────────────────────────────────────────────────────────────*/
    form { display: grid; gap: var(--sp-3); max-width: 460px; }
    label { font-weight: 600; font-size: var(--fs-sm); }
    input, select {
      width: 100%;
      min-height: var(--tap);
      padding: var(--sp-2) var(--sp-3);
      border: 1px solid var(--border);
      border-radius: var(--r-sm);
      font-size: var(--fs-base);
      background: var(--surface);
      color: var(--text);
    }
    /* Checkbox rows — styled, comfortable tap target */
    label input[type="checkbox"] {
      width: auto;
      min-height: auto;
      width: 1.25rem;
      height: 1.25rem;
      accent-color: var(--accent);
      margin-right: var(--sp-2);
      vertical-align: middle;
    }
    label:has(> input[type="checkbox"]) {
      display: flex;
      align-items: center;
      min-height: var(--tap);
      font-weight: 400;
      font-size: var(--fs-base);
    }
    fieldset {
      border: 1px solid var(--border);
      border-radius: var(--r-sm);
      padding: var(--sp-2) var(--sp-4);
    }
    legend { font-weight: 600; font-size: var(--fs-sm); padding: 0 var(--sp-2); }
    button {
      background: var(--accent);
      color: #fff;
      border: none;
      border-radius: var(--r-sm);
      padding: var(--sp-3) var(--sp-5);
      min-height: var(--tap);
      font-size: var(--fs-base);
      font-weight: 600;
      cursor: pointer;
      width: 100%;              /* full-width on mobile */
    }

    /* ── Buttons / links as actions ───────────────────────────────────────*/
    .btn-primary {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      background: var(--accent);
      color: #fff;
      text-decoration: none;
      border-radius: var(--r-sm);
      padding: var(--sp-3) var(--sp-5);
      min-height: var(--tap);
      font-weight: 600;
      width: 100%;
    }
    .btn-secondary {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      color: var(--accent);
      text-decoration: none;
      min-height: var(--tap);
      padding: var(--sp-2) var(--sp-3);
      font-weight: 600;
    }
    #meal-plan-action form { max-width: none; }
    /* Feed selection form wraps #discount-items + #meal-plan-action. display:contents
       removes its box from layout so the grid/section children flow EXACTLY as before —
       neutralizing the global form { display:grid; max-width:460px } clamp (which would
       otherwise shrink the whole feed and cause 375px overflow). */
    .selection-form { display: contents; }
    /* Per-card selection toggle — reuses the --tap target; sits inside the card,
       above the item name, so it never widens the card (no 375px overflow). */
    .card-select {
      display: inline-flex;
      align-items: center;
      gap: var(--sp-2);
      min-height: var(--tap);
      font-weight: 600;
      font-size: var(--fs-sm);
      color: var(--muted);
      cursor: pointer;
    }
    .card-select input[type="checkbox"] {
      width: 1.25rem;
      height: 1.25rem;
      min-height: auto;
      accent-color: var(--accent);
      cursor: pointer;
    }

    /* ── Recipe detail ────────────────────────────────────────────────────*/
    .recipe-ingredients { list-style: none; padding: 0; display: flex; flex-wrap: wrap; gap: var(--sp-2); }
    .recipe-ingredients li {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 999px;
      padding: var(--sp-1) var(--sp-3);
      font-size: var(--fs-sm);
    }
    .recipe-steps { padding-left: 1.25rem; display: grid; gap: var(--sp-2); }
    .on-sale-badge {
      background: var(--save-soft);
      color: var(--save);
      font-weight: 700;
      font-size: var(--fs-sm);
      padding: 0 var(--sp-2);
      border-radius: 999px;
    }

    /* Plan meal-name link — PRIMARY action; guarantee a >=44px tap target on mobile.
       Reset to inline on desktop (below) so table rows stay tidy against plain-text cells. */
    table td[data-label="Meal"] a {
      display: inline-flex;
      align-items: center;
      min-height: var(--tap);
    }

    /* Meal cards on the plan reflow — slot badge */
    .slot-badge {
      display: inline-block;
      background: var(--accent-soft);
      color: var(--accent);
      font-size: var(--fs-sm);
      font-weight: 600;
      padding: 0 var(--sp-2);
      border-radius: 999px;
    }
    a { color: var(--accent); }

    /* ── Desktop (>=768px) ────────────────────────────────────────────────*/
    @media (min-width: 768px) {
      .site-nav {
        position: sticky;
        top: 0;
        bottom: auto;
        align-items: center;
        gap: var(--sp-5);
        padding: var(--sp-3) var(--sp-5);
        border-top: none;
        border-bottom: 1px solid var(--border);
        box-shadow: none;
      }
      .site-nav .brand { display: inline-block; margin-right: var(--sp-2); }
      .site-nav a {
        flex: 0 0 auto;
        flex-direction: row;
        gap: var(--sp-2);
        min-height: var(--tap);
        padding: var(--sp-2) var(--sp-3);
        border-radius: var(--r-sm);
        font-size: var(--fs-base);
      }
      .site-nav a .nav-icon { font-size: var(--fs-base); }
      .site-nav a.active { background: var(--accent-soft); }

      .container { padding: var(--sp-5); padding-bottom: var(--sp-6); }
      .card-grid { grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: var(--sp-4); }

      /* Filter bar on desktop: pills LEFT (flex:1), overview RIGHT on the same row.
         min-width:0 lets the pills track shrink so its own overflow-x scroll engages
         instead of pushing page h-overflow; the overview gets a bounded width. */
      .filter-bar-row {
        display: flex;
        align-items: flex-start;
        gap: var(--sp-4);
      }
      .filter-bar-row .filter-pills { flex: 1 1 auto; min-width: 0; }
      /* Desktop: fixed-height toggle sits right of the pills; its list still opens
         as the absolute overlay (never grows the row → no reflow). Bounded width so
         the dropdown does not span the whole row. */
      .filter-bar-row .selection-overview {
        flex: 0 0 auto;
        width: 260px;
        max-width: 40%;
        margin-top: 0;
      }

      /* Real table on desktop */
      table { background: var(--surface); border: 1px solid var(--border); border-radius: var(--r-md); overflow: hidden; }
      table thead { display: table-header-group; }
      table tr {
        display: table-row;
        background: transparent;
        border: none;
        border-radius: 0;
        box-shadow: none;
        padding: 0;
        margin: 0;
      }
      table th, table td {
        display: table-cell;
        padding: var(--sp-2) var(--sp-3);
        border-bottom: 1px solid var(--border);
        vertical-align: middle;
      }
      table th { color: var(--muted); font-weight: 600; }
      table td[data-label]::before { content: none; }  /* thead supplies labels on desktop */
      table td[data-label="Meal"] a { display: inline; min-height: 0; }  /* keep desktop rows tidy */

      button, .btn-primary { width: auto; }
      #meal-plan-action .btn-primary { width: auto; }

      /* Toast: centered pill with a bounded width on desktop. */
      .feed-toast {
        left: 50%;
        right: auto;
        transform: translateX(-50%);
        max-width: 420px;
        width: max-content;
      }
    }
`;

function renderNav(activeNav: NavKey): string {
  const links = NAV_ITEMS.map(({ key, href, label, icon }) => {
    const isActive = key === activeNav;
    const cls = isActive ? ` class="active"` : "";
    const current = isActive ? ` aria-current="page"` : "";
    return `<a href="${href}"${cls}${current}><span class="nav-icon" aria-hidden="true">${icon}</span><span class="nav-label">${label}</span></a>`;
  }).join("\n    ");

  return `<nav class="site-nav">
    <span class="brand">DiscountHunt</span>
    ${links}
  </nav>`;
}

/** Wraps caller-supplied body HTML in the shared page shell. Body is never altered. */
export function renderPage({ title, activeNav, body }: PageOptions): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
  <style>${STYLE}</style>
</head>
<body>
  ${renderNav(activeNav)}
  <main class="container">
    ${body}
  </main>
</body>
</html>`;
}
