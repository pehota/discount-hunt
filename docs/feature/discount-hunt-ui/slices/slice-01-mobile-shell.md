# SLICE-01: Mobile-survivable shell (nav + tables)

**Job**: JOB-001, JOB-002, JOB-003 (usability constraint across all three)
**Effort**: ≤1 day
**Priority**: 1st — foundation. Every other slice adds/enriches content that must survive 375px. Fixing overflow first prevents downstream slices from colliding with it.

## Learning hypothesis
"The shell has no responsive treatment beyond the card-grid; the sticky nav (brand + 4 links, `flex`, no `flex-wrap`) and the two data tables (plan, savings) overflow at 375px."
**Disproved if**: at 375px the nav wraps/collapses cleanly AND both tables fit without horizontal scroll after this slice — with NO regression to the desktop layout.

## Today (baseline)
- `src/shared/layout.ts` `STYLE`: zero `@media` queries. `.site-nav` is `display:flex; gap:1.25rem` with brand + 4 links and no `flex-wrap`. `.container` is `max-width:960px`.
- `plan-handler.ts` and `savings-handler.ts` render full-width `<table>` (3 columns each).
- Responsive primitive that already works: `.card-grid` (`minmax(220px,1fr)`) → single column on narrow screens.

## Target (delta)
- Nav survives 375px (wraps or collapses; no clipped/scrolled links) — nav is the primary overflow suspect.
- Both data tables are readable at 375px with no horizontal scroll (stacked/responsive layout; the exact technique is a DESIGN decision).
- Desktop (≥960px) layout unchanged.

## IN scope
- Responsive treatment of the shared shell: nav + generic table behaviour in `layout.ts` `STYLE`.
- A documented mobile breakpoint.

## OUT of scope
- Content changes to what any page displays (that is SLICE-02/03/04).
- New routes, new backend behaviour.

## Production-data acceptance
Verified against the real running server (`bun run` local) at a 375px-wide viewport, using the actual shipped pages with real SQLite data — not fixtures.

## Note (coupling with SLICE-02)
SLICE-02 enriches the plan with per-meal store + sale price, which would *widen* the plan table. SLICE-01 must land the mobile-survivable table layout FIRST so SLICE-02's added content stacks rather than overflows. Explicit dependency: SLICE-02 depends on SLICE-01.
