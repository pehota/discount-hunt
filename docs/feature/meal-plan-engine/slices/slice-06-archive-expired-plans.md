# slice-06 (Technical Task): archive expired plans — bounded storage + provenance

**Story**: TECH-MPE-06 (`infrastructure-only`) · **Type**: Technical Task — NOT a standalone value slice
**Delivered inside**: slice-01's plan-persistence work · **Depends on**: slice-01 · **Effort**: ~0.5 day

> **Not a value-slice.** Its only story is infrastructure-only; a standalone all-infrastructure slice has
> no release value (review Dimension 0.5). It is a linked Technical Task, delivered within slice-01's
> DELIVER work, tracked here for traceability.
>
> **Corrected premise (verified against code)**: `/plan` already shows ONLY the current week —
> `getOrGenerateCurrentWeekPlan` and `getCurrentWeekPlan` both read `findByWeek(currentWeekMonday())`
> (`src/meal-planning/plan-service.ts:127-129,177`). Expired plans linger in STORAGE, never in the VIEW.
> So there is NO user-facing "clutter" problem — the value here is bounded storage growth + retained
> history for later analytics. That is infrastructure → Technical Task, not a user story.

## Learning hypothesis
Archiving expired saved plans (not deleting) on replace/rollover — mirroring the shipped `offer_history`
archive-on-replace pattern — bounds storage growth and preserves a longitudinal plan record for
IDEA-005 Part B, without touching the (already correct) current-week view.
**Disproves X if it fails**: if plans never accumulate meaningfully, the schema isn't worth it — defer.

## IN scope
- On plan replace / week rollover, ARCHIVE the expired saved plan (not delete), preserving original week
  + `created_at`, mirroring `SQLiteDiscountItemRepository.replaceStore` (IDEA-005 Part A, commit
  `aa49ff7`): archive `INSERT ... SELECT` as the first statement inside the transaction, before the
  delete — atomic.

## OUT of scope
- Any change to the current plan view (already shows only the current week — verified). Analytics over
  archived plans (IDEA-005 Part B, owner-gated). Draft archiving (drafts are throwaway — Discard drops).

## Acceptance
See TECH-MPE-06 ACs (feature-delta). Key: expired plans archived (not deleted); provenance preserved;
double-count guard (`plan-service.ts:100-118`) unaffected; no view change.

## Dependencies / flags
- Composes with write-once price capture (a saved plan keeps captured prices after a discount expires).
- Delivered inside slice-01 persistence — no independent demo required.

## Carpaccio taste tests (Technical-Task variant)
≤1 day? Yes (~0.5d). · End-to-end user-visible? N/A (infrastructure). · Independently valuable? No —
linked to slice-01. · ≥1 non-infra story? N/A — Technical Task, not a value-slice (delivered in S01).

## Effort
~0.5 day — archive table + archive-on-replace mirroring `offer_history`, inside slice-01's persistence.
