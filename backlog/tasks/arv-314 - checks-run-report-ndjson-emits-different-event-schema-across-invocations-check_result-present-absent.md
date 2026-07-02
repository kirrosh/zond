---
id: ARV-314
title: >-
  checks run --report ndjson emits different event schema across invocations
  (check_result present/absent)
status: Done
assignee: []
created_date: '2026-07-02 14:19'
updated_date: '2026-07-02 15:40'
labels:
  - contract
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Found on Stripe zond-audit run 20260702-170615. Same command 'zond checks run --report ndjson' emits different ndjson event types depending on selection: 30-checks.ndjson has 4116 check_result events; 40-stateful.ndjson (--check stateful) has ZERO check_result (only check_start/finding/spec_finding/summary). A downstream consumer keyed on .type==check_result (e.g. the workflow's status-distribution jq at step 10) silently yields nothing for the stateful run. Matches lessons.md §E reporter/output-channel drift class — the ndjson event schema is a contract slot and must be stable across invocations. Fix: emit check_result consistently (or document which selections omit it and why).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 checks run --report ndjson emits a stable, documented event-type set regardless of --check selection
- [ ] #2 stateful selection either emits check_result or the schema explicitly declares its absence
- [ ] #3 contract test pins the ndjson event-type set
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
stateful auth + crud loops now emit check_result events (verdict/operation/response{status}) matching the per-response phase, so the ndjson event schema is stable across --check selections. status uses outcome.responseStatus (ARV-312) when present, else 0.
<!-- SECTION:NOTES:END -->
