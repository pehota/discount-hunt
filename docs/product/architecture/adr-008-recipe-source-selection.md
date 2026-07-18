# ADR-008: Recipe SOURCE Selection for v1

**Status**: **Superseded (2026-07-18)** — reverted to Chefkoch-primary (the pre-ADR-008 state).
Original decision (Google multi-site via Custom Search JSON API) was Accepted 2026-07-17, superseded the next
day by external-API discontinuation. See "Supersession" below.
**Date**: 2026-07-17 (accepted) · 2026-07-18 (superseded)
**Wave**: DESIGN (meal-plan-engine) · **Deciders**: Dimitar (owner, locks), Morgan (solution architect)
**Relates to**: D1 (real web recipes only), D39, D39b, ADR-006 (sourcing MECHANISM — orthogonal, unchanged),
ADR-005 (dietary enforcement — addendum), SPIKE-00 (`spike/findings-00-basket-recipe-search.md`)

---

## Supersession (2026-07-18) — external-API discontinuation

**The whole cheap-web-search-API category collapsed in 2026, so ADR-008's Google multi-site decision is
unbuildable today — not merely doomed.** Verified triggers:

- **Google Custom Search JSON API is discontinued** (shuts down Jan 1 2027) **AND already closed to new
  customers** — cannot be provisioned now.
- **Brave Search API killed its free tier** (Feb 2026 — now metered / card-on-file).
- **Bing Search API is retiring.**
- **DuckDuckGo has no official web-search API.**

No viable low-cost multi-site search API exists. This is a **clean, deliberate reversal** of the 2026-07-17
Google choice driven by an external event, NOT a re-litigation of the design trade-offs.

**Decision (superseding):** revert the recipe SOURCE to **Chefkoch-primary** — the shipped
`ChefkochRecipeSource` as the primary/sole source behind the **unchanged, source-agnostic `RecipeSource`
port** (`find(query): Promise<FetchedRecipe | null>`). The port keeps the discovery→JSON-LD→verify shape
(Chefkoch site-search → first result → JSON-LD, as the shipped code already does).

**Versatility deferred, not foreclosed:** the source-agnostic `RecipeSource` port means a future source can
be added behind it **without redesign** IF a viable low-cost option reappears. The documented escalation path
if Chefkoch coverage disappoints in real use is a **local-harvested recipe corpus** (offline index) — NOT
now, per KISS/YAGNI. Chefkoch is SPIKE-proven adequate (71% found, ≥1 anchor 100%), so no escalation is
warranted at ship.

**What the revert changes back:**
- The composite (Google primary → Chefkoch fallback) collapses to **just Chefkoch**; the Google leg is
  removed. `server.ts` already wires `ChefkochRecipeSource` directly as the default — no composite needed.
- The `GoogleCustomSearchRecipeSource` + composite scaffolds and their DISTILL scenarios / support fakes are
  **deleted** (dead-API clutter; the port covers future adapters).
- **No new external system, no API key.** ADR-006 warmer + cold-cache fallback re-target Chefkoch
  site-search (their original state).
- **Dietary safety DE-ESCALATES to the SPIKE §10 posture:** RUN-5's forced-`vegetarisch` 40%→0% proof was
  measured ON CHEFKOCH, so reverting RESTORES it. Ship BOTH the forced German `vegetarisch` query term + the
  post-fetch `DietaryVerifier`, and measure residual leak over the first weeks — **RECOMMENDED, not a
  blocking slice-01b gate.** The forced query term is German `vegetarisch` (language-aware `+vegetarian` is
  dropped — single German source). The `DietaryVerifier` blocklist is German-focused (Schinken/Kalbsbrät/…
  families); leaving harmless EN terms is fine. See ADR-005 addendum + upstream-changes UC-3.

---

## Original decision (2026-07-17) — SUPERSEDED, retained for provenance

> The text below records the Google multi-site decision as it stood on 2026-07-17. It is **no longer in
> force**; read the Supersession section above for the current decision. ADR-006 (MECHANISM) was orthogonal
> and remains Accepted; only the SOURCE reverted.

The recipe SOURCE for v1 was set to Google multi-site via the official Google Custom Search JSON API
(discovery stage 1 → candidate URLs; stage 2 = JSON-LD extraction), with Chefkoch retained as a
secondary/fallback behind a composite `RecipeSource`. The two fallback axes (ADR-006 MECHANISM vs ADR-008
SOURCE) were orthogonal. The forced dietary term was made language-aware (`vegetarisch` + `vegetarian`), the
`DietaryVerifier` blocklist multi-language (DE+EN), and a 30+-basket residual-leak re-measurement on Google
results was a blocking slice-01b gate. **All of that is void under the revert** — the source is single German
Chefkoch, so no CSE key/quota, no multi-language guard, and the RUN-5 Chefkoch proof holds.
