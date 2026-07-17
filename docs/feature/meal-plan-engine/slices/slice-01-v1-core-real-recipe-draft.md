# slice-01 (v1 core, KEYSTONE): real-recipe draft + regenerate-whole + Save/Discard

**Story**: US-MPE-01 · **job_id**: JOB-001 (parent: JOB-004) · **Order**: 2nd
**Committed split → 01a + 01b** (would otherwise ship ≥4 components — owner's 4+-component rule).
**Depends on**: 01b depends on slice-00 GO; **01a does NOT** (see asymmetry). **Effort**: 2×≤1 day.

## Learning hypothesis
A generated plan of REAL, dietary-safe recipes built from the user's selected deals — as a THROWAWAY
draft the user can regenerate and then explicitly Save/Discard — is more useful than today's round-robin
item-name placeholder.
**Disproves X if it fails**: if real basket-recipes can't fill enough slots (<70% coverage) or the draft
lifecycle confuses more than it helps, the v1 core is not viable as framed.

## The split (committed) + dependency asymmetry

### slice-01a — draft lifecycle (NOT gated on the SPIKE)
Server-side draft state; **generate a throwaway DRAFT** (not persisted; existing saved plan +
`savings_log` untouched until Save — changes today's auto-save at `plan-service.ts:171,192-194`);
**regenerate-WHOLE**; explicit **Save** (via existing `savePlan`) and **Discard**. Meals may still be
round-robin item-names at this step — the lifecycle is the deliverable. **Independent of slice-00**, so
it proceeds regardless of the spike outcome. Demoable: build a draft, regenerate, Save/Discard.

### slice-01b — real basket-recipe generation (GATED on slice-00 GO)
Replace `buildMealSlot` round-robin (`src/meal-planning/plan-service.ts:75-86`) with basket-aware
real-recipe generation (extends `RecipeService`/`ChefkochRecipeSource`; uses slice-00's query builder).
Each meal shows recipe title + source link + the discounted product(s) it uses. Dietary restriction
(JOB-003) hard-gates every recipe. No-recipe state: "Couldn't build meals from these — try a different
selection" (no fabrication, never LLM-invented — D1). **This is the part slice-00 de-risks**: a NO-GO or
partial spike reshapes 01b (e.g. single-product recipes) without stalling 01a.

## OUT of scope
Cost objective (slice-03), list-source (slice-02), save→add-to-list (slice-04), per-meal lock (slice-05),
plan archiving (TECH-MPE-06, delivered here as a linked technical task). LLM-invented recipes (never, D1).

## Acceptance
See US-MPE-01 ACs. 01a: draft not persisted until Save; regenerate rebuilds whole; Save/Discard.
01b: real recipe per meal (never item-name, never invented); dietary-safe; no-recipe empty-with-reason.

## Dependencies / flags
- **Server-side draft state** required (server-rendered, no client session) — DESIGN chooses mechanism
  (feature-delta Architectural Flag 1). 01a is the v1 driver of that flag.
- Preserve replace-on-save double-count guard (`plan-service.ts:100-118`).

## Carpaccio taste tests
≤1 day each? Yes (01a, 01b each ≤1d). · End-to-end user-visible? Yes (01a: lifecycle; 01b: real recipes).
· Independently valuable? Yes (KEYSTONE). · ≥1 non-infra story? Yes (US-MPE-01).

## Effort
2×≤1 day (01a lifecycle, 01b real-recipe generation).
