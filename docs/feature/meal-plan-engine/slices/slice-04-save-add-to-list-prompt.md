# slice-04: Save → add-discounted-items-to-list prompt (D4)

**Story**: US-MPE-04 · **job_id**: JOB-001 (parent JOB-004) · **Order**: 5th
**Depends on**: slice-01 (Save); shipped `POST /list/add` · **Effort**: ~0.5 day (wiring)

## Learning hypothesis
Prompting, on Save, to add the plan's discounted products to the shopping list closes the JOB-004 loop —
the plan the user chose becomes the shop they'll buy in one step.
**Disproves X if it fails**: if users rarely accept the prompt or it feels like friction, D4's
loop-closing value is overstated.

## IN scope
- On plan Save, show a prompt: "Add this plan's discounted items to your shopping list?"
- Accept → add via shipped `ShoppingListService.addFromDiscountSelection` / `POST /list/add`
  (`src/shopping-list/http/shopping-list-handler.ts:129,146-161`); running total updates.
- Decline → plan saved, list unchanged.
- Products already on the list are not duplicated (reuse shipped add/dedup semantics).

## OUT of scope
- Building the list (shipped). The recipe engine / cost objective (slices 01/03).
- Recording plan savings into `savings_log` on add (out — display total only).

## Acceptance
See US-MPE-04 ACs. Key: prompt on save; accept adds via shipped route; decline no-ops the list;
no duplicate rows.

## Dependencies / flags
- **D2+D4 interaction (flag, not resolved here)**: when the plan's SOURCE was the shopping list
  (slice-02), the prompt adds items back to the list they came from — a near no-op / pure dedup case.
  DESIGN decides whether to dedup silently or suppress the prompt when source == list.
  (feature-delta Internal Inconsistency 2.)

## Carpaccio taste tests
≤1 day? Yes (~0.5d). · End-to-end user-visible? Yes (prompt + list updates). · Independently valuable?
Yes (closes the shop loop). · ≥1 non-infra story? Yes (US-MPE-04).

## Effort
~0.5 day — prompt UI + wiring to shipped `POST /list/add`.
