# SLICE-03: Make the saved figure the hero of the Savings page

**Job**: JOB-002
**Effort**: ≤1 day
**Priority**: 3rd — the emotional close of the journey ("motivated/satisfied").
**Depends on**: none. (Priority order puts S01 first as a preference, but there is NO hard dependency: S03 reorders/emphasises the this-week `<p>` breakdown and never touches the history `<table>`, so it does not widen anything and fits at 375px independently of the S01 nav/table fix.)

## Learning hypothesis
"The weekly SAVED figure is rendered as the third plain `<span>` in a list (Paid / Would-have-paid / Saved), giving it no more visual weight than the numbers it should dominate. The payoff of JOB-002 lands only if the saved figure is the first, largest, above-the-fold element."
**Disproved if**: emphasising the saved figure does not change whether Dimitar registers 'how much did I save' at a glance (i.e. the plain-list version already communicated it well enough).

## Today (baseline)
`src/savings/http/savings-handler.ts` `renderThisWeekBreakdown`: renders
```
<p>Paid: <span data-week-paid>…</span></p>
<p>Would have paid: <span data-week-would-have-paid>…</span></p>
<p>Saved: <span data-week-saved>…</span></p>
```
All three `<p>` lines have equal weight; "Saved" is last. Month-to-date and history table follow below.

## Target (delta)
The weekly SAVED amount is the visually dominant, first element of the Savings page — legible without scrolling on a 375px screen. Paid / would-have-paid become supporting context beneath it.

## IN scope
- Reorder and emphasise the this-week breakdown so SAVED is the hero figure.
- Ensure the hero figure is above the fold at 375px.

## OUT of scope
- Savings calculation, `data-*` attributes required by acceptance tests (must be preserved verbatim — see Technical Notes in US-08).
- History table content and month-to-date logic (unchanged).

## Production-data acceptance
Verified against the real running server with at least one week of real savings data, at 375px (above-the-fold check) and desktop.

## Note
The `data-week-saved` / `data-week-paid` / `data-week-would-have-paid` / `data-saved-amount` / `data-month-to-date` attributes are load-bearing for the shipped acceptance suite (D23 structural assertions). Presentation may change; these attributes and their values MUST survive.
