---
id: ARV-343
title: 'checks run: emit partial coverage/status artifacts on interrupt'
status: Done
assignee: []
created_date: '2026-07-06 10:52'
updated_date: '2026-07-06 14:50'
labels:
  - zond-bug
  - coverage
dependencies: []
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Evidence: live Stripe audit 2026-07-06. The coverage sweep was SIGTERM-killed before the emit stage, so 70-coverage.json and the status distribution were never written; triage had to reconstruct them from raw NDJSON. zond already flushes partial NDJSON — it should also flush a partial coverage/status summary on SIGTERM so interrupted runs stay analyzable.
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
checks.ts: accumulate ops/cases/findings/by_severity from the NDJSON stream; SIGTERM/SIGINT shutdown emits a schema-exact partial {type:summary} line before closing the fd, so sweepWindows/status-dist stay analyzable on a killed window. by_category/skipped left empty (not derivable in CLI), stderr note flags it partial.
<!-- SECTION:NOTES:END -->
