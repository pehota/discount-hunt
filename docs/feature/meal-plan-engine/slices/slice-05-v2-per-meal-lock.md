# slice-05 (v2): per-meal lock + partial regenerate + cross-source stickiness (D3)

**Story**: US-MPE-05 · **job_id**: JOB-001 (parent JOB-004) · **Order**: 6th
**Depends on**: slice-01, slice-02 · **Effort**: ~1 day · **Deferred to v2 by D5/D8**

## Learning hypothesis
Letting the user accept individual meals and regenerate only the rest — with accepted meals surviving
regenerations AND source switches (D3) — lets them converge on a plan faster without losing good picks.
**Disproves X if it fails**: if partial-regen state confuses more than whole-regen (v1), the added
complexity isn't worth it and D3 should stay deferred.

## IN scope
- Mark individual draft meals "accepted".
- Regenerate replaces ONLY un-accepted meals; accepted meals preserved verbatim.
- Accepted meals persist across regenerations AND across a source switch (feed ↔ list): accept on a
  list-based draft → switch to feed → regenerate → accepted survive, rest reroll from feed.
- Save persists exactly the current draft (accepted + last-regenerated).

## OUT of scope
- v1 whole-regen (slice-01, unchanged as the default). Cost objective (slice-03) beyond respecting locks.
  Archiving (slice-06).

## Acceptance
See US-MPE-05 ACs. Key: per-meal accept; partial regen preserves accepted; cross-source stickiness;
save persists the accepted+regenerated set.

## Dependencies / flags
- Extends the **server-side draft state** from slice-01 with per-meal accepted flags that survive a
  source switch (feature-delta Architectural Flag 1). Highest state complexity in the feature — the
  reason D5/D8 defer it to v2.

## Carpaccio taste tests
≤1 day? Yes. · End-to-end user-visible? Yes (lock a meal, reroll rest). · Independently valuable? Yes
(converge without re-earning meals). · ≥1 non-infra story? Yes (US-MPE-05).

## Effort
~1 day — per-meal accepted state + partial-regen selection over the existing draft.
