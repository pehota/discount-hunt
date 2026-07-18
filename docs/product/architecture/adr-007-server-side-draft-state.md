# ADR-007: Server-Side Meal-Plan Draft State

**Status**: Accepted
**Date**: 2026-07-17
**Wave**: DESIGN (meal-plan-engine) · **Deciders**: Morgan (solution architect)
**Relates to**: D5 (v1 throwaway drafts), D3 (v2 sticky accepted meals), D42; DISCUSS Architectural Flag 1

---

## Context

v1 (US-MPE-01) ships throwaway drafts: generate → regenerate-whole → explicit Save / Discard. A draft must
survive the generate→regenerate→Save gap and stay distinct from the persisted `meal_plans` weekly commitment
until Save. The app is server-rendered HTML with **no SPA / no client session** (D31) — a draft cannot live
only in the browser. v2 (US-MPE-05) extends the draft with per-meal `accepted` state and cross-source
stickiness. Single-user, local, <1 QPS (capacity table). The mechanism was flagged OPEN for DESIGN.

---

## Decision

**A single-user draft singleton in SQLite** — a new `plan_drafts` table with a fixed PK (`user_id =
'dimitar'`), mirroring the shipped `user_settings` singleton pattern
(`sqlite-user-preferences-repository.ts`, upsert-on-conflict). Accessed via a new
`PlanDraftRepository` driven port. Contract shape: **bounded-change** — a draft write touches only the
draft row; it NEVER touches `meal_plans` or `savings_log` (that is the Save boundary).

Draft columns: `user_id` (PK), `source` (`feed`|`list`), `source_ids` (JSON), `meals` (JSON — carries
`discountItemIds[]`, `recipeId`, title, and in v2 `accepted`), `dietary_filter` snapshot, `updated_at`.

**Lifecycle (shell use cases on `PlanService`):** `generateDraft` (upsert), `regenerateDraft` (upsert —
whole in v1, un-accepted-only in v2), `saveDraft` → shipped `savePlan` (the only path that writes
`meal_plans`+`savings_log`), `discardDraft` (delete row).

---

## Alternatives Considered

| Alternative | Rejected because |
|-------------|------------------|
| Client-only (hidden form / localStorage) | Server-rendered app, no client session (D31); draft would not survive navigation (v2 cross-source stickiness needs server state) |
| Redis / session store | A second data store + daemon for one user's one draft at <1 QPS — over-engineering, contradicts D13/D14 (SQLite-only), same reasoning as rejected Alternative C in the System Architecture |
| In-memory process singleton | Lost on restart; no cross-request durability guarantee; SQLite singleton is the same cost with durability |
| Reuse `meal_plans` with a `draft` flag | Pollutes the committed-plan aggregate + the replace-on-save double-count guard; drafts must be structurally separate from the weekly commitment (D5) |

---

## Consequences

**Positive:** reuses the shipped singleton pattern + Drizzle + shared WAL probe; zero new dependency;
durable across restarts; structurally separate from `meal_plans` so the replace-on-save double-count guard
(`plan-service.ts:100-118`) is untouched; v2 extension is one JSON column change.

**Negative:** one more table + port + adapter (accepted — the draft/commitment separation is a hard D5
requirement). Single-user assumption baked into the fixed PK (consistent with the whole app; documented).

**Enforcement:** `PlanDraftRepository` bounded-change contract — adapter test asserts a draft write leaves
`meal_plans` and `savings_log` unchanged (the Save boundary). WAL probe covers the new table.
