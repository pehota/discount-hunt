# ADR-004: Application Tech Stack

**Status**: Accepted
**Date**: 2026-07-13
**Deciders**: Architecture wave (D29–D32)

---

## Context

Greenfield TypeScript project. SPIKE probe code was written in Bun TypeScript, validating the runtime. Need to select HTTP server, ORM, frontend rendering strategy, and test framework. Single-user localhost app; simplicity and zero ops overhead are dominant quality attributes.

---

## Decision

| Layer | Choice | Version |
|-------|--------|---------|
| Runtime | Bun | latest stable |
| HTTP server | `Bun.serve` (built-in) | — |
| ORM | Drizzle ORM | latest stable |
| Schema migrations | Drizzle Kit | latest stable |
| Frontend | Server-rendered HTML + HTMX | HTMX 2.x |
| Test framework | Bun test (built-in) | — |
| Architectural linting | dependency-cruiser | latest stable |

---

## Rationale

### HTTP server — `Bun.serve` over Hono / Elysia

Bun.serve is built-in, zero dependency. At <1 QPS from one user, routing performance is irrelevant. Hono and Elysia are excellent frameworks but add a dependency and abstraction layer for no practical gain at this scale. If routing complexity grows (e.g. auth middleware, multiple content types), Hono is the obvious upgrade path — the switch is ~50 LOC.

### ORM — Drizzle over bun:sqlite direct or Prisma

bun:sqlite direct: fast, zero deps, but no schema type safety and manual migration management. `regular_price IS NOT NULL` and other column invariants become runtime assertions rather than compile-time types — exactly the class of bug the domain model is designed to prevent.

Prisma: generates a client, requires a separate generation step, non-Bun-native runtime (uses Node.js-compatible engine). Adds ~150 MB to the install. Rejected.

Drizzle: type-safe schema, compiles to SQL directly, Bun-compatible, Drizzle Kit generates inspectable SQL migration files. The right tradeoff.

### Frontend — Server HTML + HTMX over SPA (React / Svelte / Vue)

No build step. No client-side state management. No SSR hydration. One human opens this on localhost a few times per week. HTMX `hx-get` on meal title links satisfies US-03 acceptance criteria ("opens without full page reload") without introducing a JavaScript framework. Server-side HTML templates (inline Bun JSX or template literals) are readable and maintainable by a single developer. SPA frameworks are rejected: the complexity they solve (client routing, state, bundling) is not a problem this app has.

### Test framework — Bun test over Vitest

Bun test is built-in, zero configuration, runs in the same runtime as production code. Vitest requires Node.js-compatible config and adds a dev dependency. Same API surface. Bun test wins on simplicity.

---

## Consequences

- HTMX must be loaded from a CDN or bundled as a single file in `public/htmx.min.js` — no npm build step.
- Drizzle Kit migration files are committed to version control in `drizzle/migrations/`.
- `dependency-cruiser` config (`.dependency-cruiser.cjs`) defines the three enforcement rules from D34: (a) no cross-context imports except `src/shared/`; (b) only `src/*/adapters/sqlite-*.ts` → `src/shared/schema.ts`; (c) no domain service → HTTP handler.
- Bun.serve composition root (`src/server.ts`) instantiates all dependencies — no DI container.

---

## Alternatives Considered

| Alternative | Rejected because |
|-------------|-----------------|
| Hono framework | Adds a dependency for routing features not needed at <1 QPS; easy upgrade path if needed |
| Elysia framework | Same as Hono; Bun-native but more opinionated than needed |
| Prisma | Non-Bun-native runtime, 150 MB install, generated client adds build step |
| bun:sqlite direct | No compile-time schema types; `regular_price` invariant becomes a runtime check |
| React SPA | Build step, client-side routing, SSR complexity — none of these problems exist here |
| Svelte SPA | Same as React; lighter but still introduces a compilation step |
| Vitest | Extra dev dependency for identical API to built-in Bun test |
