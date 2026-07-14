/**
 * Shared Kernel — page layout shell.
 *
 * renderPage({ title, activeNav, body }) wraps caller-supplied inner-body markup
 * in a full HTML document: doctype, <head> (charset, viewport, escaped <title>),
 * an inline <style> implementing a clean utility theme (light bg, system-ui font,
 * max-width container, a top .site-nav bar with the brand + four route links, a
 * responsive .card-grid, and basic table/banner styling), and a top nav with the
 * active page marked.
 *
 * Contract shape: pure-function / return-only. The body string is NEVER transformed
 * — callers pass ready-to-render HTML and every asserted marker/attribute inside it
 * survives verbatim. Only the title is escaped (untrusted-safe by default).
 */

import { escapeHtml } from "./html.ts";

export type NavKey = "feed" | "plan" | "savings" | "settings";

export interface PageOptions {
  readonly title: string;
  readonly activeNav: NavKey;
  readonly body: string;
}

const NAV_ITEMS: ReadonlyArray<{ key: NavKey; href: string; label: string }> = [
  { key: "feed", href: "/", label: "Feed" },
  { key: "plan", href: "/plan", label: "Plan" },
  { key: "savings", href: "/savings", label: "Savings" },
  { key: "settings", href: "/settings", label: "Settings" },
];

const STYLE = `
    :root {
      --bg: #f5f6f8;
      --surface: #ffffff;
      --border: #e2e5ea;
      --text: #1f2733;
      --muted: #5b6472;
      --accent: #2f6f4f;
      --sale: #c0392b;
      --warning-bg: #fff4e5;
      --warning-border: #f0c27b;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
      background: var(--bg);
      color: var(--text);
      line-height: 1.5;
    }
    .site-nav {
      display: flex;
      align-items: center;
      gap: 1.25rem;
      padding: 0.75rem 1.5rem;
      background: var(--surface);
      border-bottom: 1px solid var(--border);
      position: sticky;
      top: 0;
    }
    .site-nav .brand {
      font-weight: 700;
      font-size: 1.15rem;
      color: var(--accent);
      margin-right: 0.5rem;
    }
    .site-nav a {
      text-decoration: none;
      color: var(--muted);
      padding: 0.25rem 0.5rem;
      border-radius: 6px;
    }
    .site-nav a.active {
      color: var(--text);
      background: var(--bg);
      font-weight: 600;
    }
    .container {
      max-width: 960px;
      margin: 0 auto;
      padding: 1.5rem;
    }
    h1 { font-size: 1.5rem; }
    h2 { font-size: 1.15rem; }
    .card-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
      gap: 1rem;
    }
    .card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 1rem;
    }
    .card .item-name { margin: 0 0 0.5rem; font-size: 1rem; }
    .was-price { color: var(--muted); text-decoration: line-through; margin-right: 0.5rem; }
    .sale-price { color: var(--sale); font-weight: 700; }
    table { width: 100%; border-collapse: collapse; background: var(--surface); }
    th, td { text-align: left; padding: 0.5rem 0.75rem; border-bottom: 1px solid var(--border); }
    th { color: var(--muted); font-weight: 600; }
    .staleness-warning, .over-budget-warning, .empty-plan-warning,
    .no-discounts-warning, .empty-state, .settings-saved {
      background: var(--warning-bg);
      border: 1px solid var(--warning-border);
      border-radius: 8px;
      padding: 0.75rem 1rem;
      margin: 0.5rem 0;
    }
    .settings-saved { background: #e6f4ea; border-color: #a3d9b1; }
    form { display: grid; gap: 0.5rem; max-width: 360px; }
    input, select { padding: 0.4rem; border: 1px solid var(--border); border-radius: 6px; }
    button {
      background: var(--accent);
      color: #fff;
      border: none;
      border-radius: 6px;
      padding: 0.5rem 0.9rem;
      cursor: pointer;
      justify-self: start;
    }
`;

function renderNav(activeNav: NavKey): string {
  const links = NAV_ITEMS.map(({ key, href, label }) => {
    const isActive = key === activeNav;
    const cls = isActive ? ` class="active"` : "";
    const current = isActive ? ` aria-current="page"` : "";
    return `<a href="${href}"${cls}${current}>${label}</a>`;
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
