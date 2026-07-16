# CLAUDE.md

## Workflow

- trunk-based development; no feature branches
- git worktrees only when working on parallel tasks
- any push goes straight to production

## Development Paradigm

- OOP — TypeScript classes for services and adapters.

## Architecture

- Hexagonal - ports and adapters

## Mutation Testing Strategy

nightly-delta — CI runs mutation tests nightly on changed modules; per-feature gates are skipped.

## Type checking

Type-check with `bun run typecheck` (tsc --noEmit, strict: noUncheckedIndexedAccess + exactOptionalPropertyTypes). It must stay at zero errors. Run it as part of every change's verification (alongside `bun test`) BEFORE committing — not deferred to push. It is gated at pre-push via `bun run hook:push`.

## Bug handling

- When you discover a bug during any task, FIX IT proactively — do not just flag it and wait for approval. Add a regression test, verify (typecheck + tests + browser where relevant), and commit it (its own bundle). Applies to bugs found incidentally, not only the ones you were asked about.

## Structure

- collocated tests

## Commit conventions

- conventional commits
- use /commit-commands:commit to do the commits
- commit after any meaningful, self-contained, complete, and verified set of changes

## Principles

- KISS
- DRY
- SOLID
- single responsibility
- separation of concerns
- single source of truth
