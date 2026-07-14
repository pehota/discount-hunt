/**
 * Shared Kernel — HTML output escaping.
 *
 * escapeHtml(s) makes an untrusted string safe to interpolate into server-rendered
 * HTML text/attribute context. Scraped discount item names are untrusted input;
 * interpolating them raw is a stored-XSS vector (03-08 adversarial-review D3).
 *
 * Contract shape: pure-function / return-only. A plain string (no special chars)
 * passes through unchanged — escaping "Rindersteak" is a no-op.
 */

const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

/** Escapes HTML-special characters (& < > " ') for safe interpolation into HTML. */
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => HTML_ESCAPES[char] ?? char);
}
