/**
 * Unit tests for renderPage — the shared page layout helper.
 *
 * Contract (pure function, no I/O):
 *   renderPage({ title, activeNav, body }) returns a full HTML document with
 *   a doctype, an inline <style> block, a top nav (class=site-nav) linking the
 *   four routes (/ /plan /savings /settings), the active nav item marked, an
 *   escaped <title>, and the caller-supplied body markup passed through verbatim.
 *
 * # bypass: this is a server-rendered-HTML helper with exact-string/attribute
 * assertions (doctype, <style>, nav hrefs, active marker, title escaping, body
 * pass-through) — a single-shot rendering contract, not an invariant over an
 * equivalence class. Property-framing adds no coverage here.
 */

import { describe, test, expect } from "bun:test";
import { renderPage, type NavKey } from "./layout.ts";

describe("renderPage — shared page shell", () => {
  test("returns a full HTML document with a doctype", () => {
    const html = renderPage({ title: "Feed", activeNav: "feed", body: "<p>x</p>" });
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toMatch(/<html\b[^>]*lang="en"/);
  });

  test("includes an inline <style> block", () => {
    const html = renderPage({ title: "Feed", activeNav: "feed", body: "" });
    expect(html).toContain("<style");
    expect(html).toContain("</style>");
  });

  test("renders a top nav with class=site-nav and all five route links", () => {
    const html = renderPage({ title: "Feed", activeNav: "feed", body: "" });
    expect(html).toContain(`class="site-nav"`);
    expect(html).toMatch(/href="\/"/);
    expect(html).toMatch(/href="\/plan"/);
    expect(html).toMatch(/href="\/savings"/);
    expect(html).toMatch(/href="\/list"/);
    expect(html).toMatch(/href="\/settings"/);
  });

  test("marks the active nav item for the given activeNav", () => {
    const cases: Array<{ activeNav: NavKey; href: string }> = [
      { activeNav: "feed", href: "/" },
      { activeNav: "plan", href: "/plan" },
      { activeNav: "savings", href: "/savings" },
      { activeNav: "list", href: "/list" },
      { activeNav: "settings", href: "/settings" },
    ];
    for (const { activeNav, href } of cases) {
      const html = renderPage({ title: "T", activeNav, body: "" });
      // The active link carries class="active" (and aria-current); locate the
      // anchor for this href and assert it is the active one.
      const anchorRegex = new RegExp(`<a[^>]*href="${href.replace("/", "\\/")}"[^>]*>`);
      const match = html.match(anchorRegex);
      expect(match).not.toBeNull();
      expect(match![0]).toContain("active");
    }
  });

  test("escapes the title", () => {
    const html = renderPage({ title: `<script>alert(1)</script>`, activeNav: "feed", body: "" });
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).not.toContain("<title><script>");
  });

  test("passes the body markup through unchanged", () => {
    const body = `<section data-marker><h2>Aldi Süd</h2><span data-x="42">keep me</span></section>`;
    const html = renderPage({ title: "Feed", activeNav: "feed", body });
    expect(html).toContain(body);
  });

  test("wraps the body in a main.container element", () => {
    const html = renderPage({ title: "Feed", activeNav: "feed", body: "<p>inner</p>" });
    expect(html).toMatch(/<main[^>]*class="container"[^>]*>/);
  });

  /** Isolate the anchor for a given href (opening tag through its closing </a>). */
  function listAnchor(html: string): string {
    return html.match(/<a[^>]*href="\/list"[\s\S]*?<\/a>/)?.[0] ?? "";
  }

  test("renders a nav-badge with the count inside the list link when listCount > 0", () => {
    const html = renderPage({ title: "List", activeNav: "list", body: "", listCount: 3 });
    const anchor = listAnchor(html);
    expect(anchor).toContain(`class="nav-badge" data-nav-badge`);
    expect(anchor).toMatch(/<span class="nav-badge" data-nav-badge>3<\/span>/);
  });

  test("renders the nav-badge regardless of which page is active (badge count only)", () => {
    // On a non-list page (feed active), the list badge still shows the count.
    const html = renderPage({ title: "Feed", activeNav: "feed", body: "", listCount: 5 });
    const anchor = listAnchor(html);
    expect(anchor).toMatch(/<span class="nav-badge" data-nav-badge>5<\/span>/);
  });

  test("renders NO nav-badge element when listCount is 0 or undefined", () => {
    // Scope to the /list anchor: the STYLE block always defines a .nav-badge rule, so a
    // page-wide substring check is invalid — the badge ELEMENT lives inside the anchor.
    for (const html of [
      renderPage({ title: "List", activeNav: "list", body: "", listCount: 0 }),
      renderPage({ title: "List", activeNav: "list", body: "" }),
    ]) {
      expect(listAnchor(html)).not.toContain("nav-badge");
      expect(listAnchor(html)).not.toContain("data-nav-badge");
    }
  });

  test("the nav-badge appears ONLY on the list item, never on other nav items", () => {
    const html = renderPage({ title: "Feed", activeNav: "feed", body: "", listCount: 2 });
    // Exactly one badge, and it lives inside the /list anchor.
    expect(html.match(/data-nav-badge/g)).toHaveLength(1);
    expect(listAnchor(html)).toContain("data-nav-badge");
    // The other anchors carry no badge.
    for (const href of ["/", "/plan", "/savings", "/settings"]) {
      const anchor = html.match(new RegExp(`<a[^>]*href="${href.replace("/", "\\/")}"[\\s\\S]*?</a>`))?.[0] ?? "";
      expect(anchor).not.toContain("nav-badge");
    }
  });
});
