# slice-02: shopping-list page as contextual generation source (D2)

**Story**: US-MPE-02 · **job_id**: JOB-001 (parent JOB-004) · **Order**: 4th
**Depends on**: slice-01 · **Effort**: ~0.5 day (mostly wiring)

## Learning hypothesis
Letting the user generate a plan from the items already on their shopping list (trigger location = source,
D2) produces a plan that agrees with the shop they've committed to — more useful than always reading the
feed selection.
**Disproves X if it fails**: if list-sourced plans feel redundant with feed-sourced ones, D2's
contextual-source model adds no value.

## IN scope
- A "generate plan from this list" action on `GET /list` (`src/shopping-list/http/shopping-list-handler.ts`).
- Source-selection logic: trigger on the LIST → source = list's discounted items
  (`ShoppingListService.getCurrentList()`, `src/shopping-list/shopping-list-service.ts:86`); trigger on
  the FEED → source = feed selection (or all discounts if none) — the existing behaviour (D2).
- Empty-list generation → "Your list is empty — add items first" (no fabricated plan).

## OUT of scope
- Building/altering the shopping list itself (already shipped). The recipe engine (slice-01).
  Save→add-to-list (slice-04). Cost objective (slice-03).

## Acceptance
See US-MPE-02 ACs. Key: list action present; source follows trigger location (D2); empty-list explained;
reuses `getCurrentList()` (no new read model — SSOT).

## Dependencies / flags
- Reuses shipped `ShoppingListService`/`GET /list`. Only new logic is source-selection by trigger.
- Feeds the same draft lifecycle from slice-01 (server-side draft state).

## Carpaccio taste tests
≤1 day? Yes (~0.5d). · End-to-end user-visible? Yes (plan from my list). · Independently valuable? Yes
(plan the exact shop). · ≥1 non-infra story? Yes (US-MPE-02).

## Effort
~0.5 day — wiring to shipped list service + source-selection branch.
