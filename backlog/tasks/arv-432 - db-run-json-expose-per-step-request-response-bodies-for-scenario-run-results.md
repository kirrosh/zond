---
id: ARV-432
title: >-
  db run --json: expose per-step request/response bodies for scenario/run
  results
status: Done
assignee: []
created_date: '2026-07-11 07:43'
updated_date: '2026-07-11 08:02'
labels:
  - m-28
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Stripe deep-dive (m-28): to see WHY a scenario step 400'd, 'zond db run <id> --json' returns null for response.body/request.body — the body IS persisted (--report json artifact shows it) but the db projection drops it. Cost 3 extra live round-trips to reproduce a 400 already captured. Fix: surface persisted request/response bodies in db run --json (respect --no-body-cap / redaction). Deterministic → zond.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 db run <id> --json includes per-step request.body and response.body when persisted
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Fixed: src/core/diagnostics/db-analysis.ts getRunDetail — projects request_body/response_body/response_headers (already redacted+truncated at write time). Verified live: db run <id> --json now carries per-step bodies.
<!-- SECTION:NOTES:END -->
