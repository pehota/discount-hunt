# Execution prompt — paste this to resume after clearing context

> Execute the discount-hunt backlog in `docs/PLAN.md` to completion, **autonomously**, in **LEAN mode** — you ORCHESTRATE, subagents implement. I have cleared context specifically so I don't have to watch you work: see the plan through to **functional AND visual completeness and correctness**, and only interrupt me where truly necessary (below).
>
> **Read first, in order:** `docs/PLAN.md` (ordered backlog + each item's `Verify:` + the shared Definition of Done), your memory (`MEMORY.md`, `autonomy-over-oversight.md`, `project_delivery_state.md`), and `CLAUDE.md` (trunk-based/commit-to-main, OOP, hexagonal ports-and-adapters, KISS/DRY/SOLID/SSOT, colocated tests).
>
> **Per-item loop (lean = implement → verify → review → commit):**
> 1. **Implement** — dispatch a subagent (generic `claude`) with a precise TEST-FIRST brief. You do NOT write code yourself; you orchestrate, brief, and integrate.
> 2. **Verify (you, first-hand):** `bun run typecheck` = 0 AND `bun test` = 0 fail. For any UI item, verify **in a real browser** (Chrome DevTools MCP) at **375px AND desktop**: assert `scrollWidth - clientWidth == 0`, **exercise the real interaction** (clicks/fetch, not just markup), and **screenshot to confirm it looks right** (visual completeness), not merely that tests pass. For logic, do a **real-data run** (e.g. inspect the categorised real DB).
> 3. **Review** — dispatch an INDEPENDENT reviewer subagent to critique the diff (correctness, completeness, the CLAUDE.md principles, no weakened/behavioural tests removed). Address every valid finding (fix subagent + re-verify).
> 4. **Commit** — one conventional-commit bundle per item, straight to `main` (trunk-based, no branches). Update `docs/PLAN.md` (mark shipped) + memory. Then next item.
>
> **Autonomy — do NOT make me watch:**
> - Decide all **reversible** calls yourself (UI defaults, naming, structure, badge style, copy). Do NOT stop to ask; record them and give me a **"decisions I made — veto any"** list at the end.
> - **Stop and ask ONLY for:** (a) the **V-Markt LIVE scrape** in item #2 — it needs my model key/endpoint (or local Ollama URL); build + fully unit-test the provider abstraction, then **PAUSE** and ask before the live run; (b) genuinely irreversible / destructive / outward-facing actions; (c) a product-taste call so consequential and unguessable a wrong default is expensive.
>
> **Order:** ① list-counter badge → ② Vercel AI SDK provider (unit-tested; PAUSE for key before live V-Markt) → ③ hybrid categorisation → category filter + price-asc sort → shopping list grouped by category. **Edeka (#4) stays PARKED — do not start it.**
>
> **Quality bar:** every item's `Verify:` met on top of the Definition of Done; hexagonal ports-and-adapters + OOP + KISS/DRY/SOLID/SSOT; never weaken a behavioural test to make it pass; functional + visual both proven.
>
> **Gotchas (heed PLAN.md):** before any browser verify, kill the orphan `bun` on :3000 (`ss -ltnp | grep :3000`) and start fresh — Bun does not hot-reload; confirm it serves current code. SQLite WAL: a fresh `sqlite3` CLI read may show 0 rows the server has (writes sit in `-wal`) — not a bug. `bun run lint:arch` is broken (missing config) — ignore, respect the D34 boundary manually.
>
> **When done (or paused at the key wall), return ONE summary:** commits shipped, the "decisions I made — veto any" list, per-item verification evidence (incl. screenshots/measurements for UI), and anything blocked. Do not narrate intermediate steps — I want the outcome.
