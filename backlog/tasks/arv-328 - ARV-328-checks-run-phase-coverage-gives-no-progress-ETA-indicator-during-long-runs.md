---
id: ARV-328
title: >-
  ARV-328: checks run --phase coverage gives no progress/ETA indicator during
  long runs
status: To Do
assignee: []
created_date: '2026-07-03 08:26'
labels:
  - checks
dependencies: []
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Found on Stripe zond-audit run 20260703-103831 (raw/30-checks.ndjson). 'zond checks run --api stripe --phase coverage --workers 4 --rate-limit 30 --report ndjson' against a 587-endpoint/674-test full-surface coverage pass runs silently until completion or interruption -- the only visible artifact is the growing ndjson file. A caller operating under a wall-clock budget (CI job, a 10-minute subagent/bash-tool timeout, etc.) has no way to tell whether to expect completion or estimate remaining work, and in practice had to kill it externally after 10 minutes with zero visibility (22,187 lines written by then). Fix: emit a periodic progress marker (e.g. a low-frequency ndjson event or stderr line like 'N/674 cases run, ~M remaining') during --report ndjson / --report json coverage runs.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 a long checks run --phase coverage run periodically reports progress (cases run / total) somewhere observable (stderr or a dedicated ndjson event type), without breaking the existing event schema for consumers keying on type
<!-- AC:END -->
