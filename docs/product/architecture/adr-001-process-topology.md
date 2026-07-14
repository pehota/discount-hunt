# ADR-001: Process Topology

**Status**: Accepted
**Date**: 2026-07-13
**Deciders**: Titan (nw-system-designer)
**Supersedes**: —
**Superseded by**: —

---

## Context

discount-hunt is a single-user localhost app that:

- Scrapes 3 supermarket catalogues once per week (Monday 06:00 CET)
- Serves a web UI for one human user generating ~5 plan views/week
- Performs ~5 recipe lookups/week via Brave Search API
- Peak load: one person clicking "Generate Plan"

**Capacity numbers:**

| Dimension | Value |
|-----------|-------|
| Concurrent users | 1 |
| QPS (web) | < 1 |
| Scraper frequency | 1 run/week (~30s runtime) |
| Recipe lookups | ~5/week |

The primary topology question is: how many processes should run, and how should scheduling be handled?

Two axes to decide:

1. **Number of processes** — monolith vs web + worker
2. **Scheduler** — in-process (`node-cron`/`Bun.cron`) vs OS cron vs systemd timer

These axes are coupled: in-process scheduling requires a long-running worker process; OS cron/systemd works naturally with a one-shot script invoked alongside a separate web server.

---

## Decision

**Modular monolith** (one Bun HTTP process for web) + **OS cron or systemd timer** invoking a one-shot scraper script.

```
systemd timer / crontab
    │
    └──▶ bun run scrape.ts   (exits after completion)
             │
             └──▶ discount-hunt.db (SQLite)

browser
    │
    └──▶ bun run server.ts   (long-lived)
             │
             └──▶ discount-hunt.db (SQLite)
```

The web process and scraper script share only the SQLite database file. No inter-process communication, no shared memory, no message broker.

---

## Consequences

**Positive:**

- One web process to start, monitor, and restart. `systemctl status discount-hunt` is sufficient.
- Scraper runs independently of web process uptime. Monday scrape succeeds whether or not Dimitar has the browser open.
- Scraper crashes do not affect web serving. Web crashes do not affect scheduled scrapes.
- No persistent worker process consuming RAM 99.9% of the time doing nothing.
- One-shot script is trivially testable in isolation (`bun run scrape.ts --dry-run`).

**Negative / trade-offs:**

- Two invocation mechanisms (systemd/cron for scraper, process manager for web). Slightly higher setup friction than a single Docker Compose `up`.
- No in-process scrape-on-demand from the web server without a subprocess call or HTTP self-call. If ad-hoc re-scrape from the UI is wanted, it must shell out or hit an internal endpoint. Acceptable for v1; can be added via a `/api/scrape` endpoint that spawns a child process.
- SQLite concurrent write window: scraper writing while web server reads. SQLite WAL mode handles this correctly (readers never block writers; writer never blocks readers). No action needed beyond `PRAGMA journal_mode=WAL`.

---

## Alternatives Considered

### Alternative 1 — Web + Dedicated Worker Process + In-Process Scheduler

One process serves HTTP; a second long-running worker process runs `node-cron` or `Bun.cron` and executes the scraper on schedule.

**Rejected because:**
- Permanent worker process idle 99.9% of the time (1 run/week × ~30s).
- In-process scheduler couples scraper liveness to worker process uptime. If worker crashes or is restarted, next scheduled tick is missed unless the scheduler library has explicit missed-tick recovery (most do not).
- Two processes require two `systemctl` units or two Compose services to manage.
- No benefit: the extra process solves a concurrency problem that does not exist at <1 QPS.

### Alternative 2 — Single Process, In-Process Scheduler (no separate worker)

One Bun process serves HTTP and embeds `node-cron` for weekly scraper execution.

**Rejected because:**
- Couples scrape liveness to web server uptime. If Dimitar restarts the server at 05:58 on Monday, the 06:00 tick fires inside an initialising process with unclear state.
- Web server restarts (code deploy, crash recovery) reset the in-process scheduler — missed-tick risk without external state.
- Adds a dependency (`node-cron` or equivalent) that OS cron already provides for free.
- Harder to test scraper in isolation: must mock the HTTP layer or route around it.

### Alternative 3 — Web + Worker + Message Queue (BullMQ / pg-boss)

Full job queue infrastructure: web server enqueues scrape jobs; worker dequeues and executes; queue persists job state.

**Rejected because:**
- Queue broker (Redis or Postgres-backed) is a third infrastructure component for one job per week.
- Failure retry, job deduplication, and dead-letter handling solve real problems at scale — not for a weekly 30-second task run by one person on localhost.
- Adds ~300 MB of additional runtime (Redis image) or queue schema migrations for no measurable reliability improvement over OS cron.
