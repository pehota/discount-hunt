# SLICE-04: Savings history (multi-week tracker)

## Goal
Extend the savings tab to show a history of weekly savings across multiple plan cycles, plus a month-to-date total, so Dimitar can see the cumulative financial impact over time.

## IN Scope
- savings_log table: one row per week (week_start, items_on_discount, total_sale, total_regular, saved_amount)
- Savings tab: this-week breakdown + history list + month-to-date total
- Honest "Savings unavailable" message when regular_price was not captured for a week
- History persists across app restarts (DB-backed, not in-memory)

## OUT Scope
- Per-store savings breakdown — future
- Annual projection — future
- Export / download savings history — future

## Learning Hypothesis
**Confirms**: Seeing cumulative savings across 2+ weeks reinforces the habit of using the app to plan groceries.
**Disproves if it fails**: The assumption that a running savings total is a sufficient motivational reinforcer. If Dimitar still does not return to the app after 3 weeks even with the savings history visible, the motivational lever may be different (e.g., recipe variety, reduced decision fatigue) and the product direction needs reassessment.

## Acceptance Criteria
- Savings tab shows: this week's savings breakdown (paid, would-have-paid, saved €)
- History list shows one entry per prior week with savings amount
- Month-to-date total shown as running sum of current month's weeks ("current month" = the calendar month of the current week's Monday, i.e. `currentWeekMonday().slice(0,7)`)
- When regular_price was not captured for a week, "Savings unavailable" shown for that week (not €0) — this applies to the current-week breakdown too, not only the history rows
- Data survives app restart (DB-persisted)

## Dependencies
- SLICE-01 complete (savings_log table started with week 1)
- Requires 2+ weeks of real usage to be fully meaningful; acceptable to ship with week 1 only as "history will grow"

## Effort Estimate
≤1 day (savings_log persistence already started in SLICE-01; this slice adds the history display and month aggregate)
Reference class: "read table + render list + compute monthly SUM"

## Dogfood Moment
After using the app for 2 weeks, Dimitar opens the Savings tab and sees "Week 1: €8.40 | Week 2: €11.20 | Month total: €19.60." The number is concrete. He shares it with no one but feels satisfied.
