# CLAUDE.md

## Workflow

- trunk-based development; no feature branches
- git worktrees only when working on parallel tasks
- any push goes straight to production

## Development Paradigm

- OOP — TypeScript classes for services and adapters.

## Mutation Testing Strategy

nightly-delta — CI runs mutation tests nightly on changed modules; per-feature gates are skipped.

## Type checking

Type-check with `bun run typecheck` (tsc --noEmit, strict: noUncheckedIndexedAccess + exactOptionalPropertyTypes). It must stay at zero errors. Run it as part of every change's verification (alongside `bun test`) BEFORE committing — not deferred to push. It is gated at pre-push via `bun run hook:push`.

## Structure

- collocated tests

## Commit conventions

- conventional commits
- use /commit-commands:commit to do the commits
- commit after any meaningful, self-contained, complete, and verified set of changes
