---
id: ARV-305
title: 'ARV-305 — db diagnose --json: failures[].reason = null in examples'
status: To Do
assignee: []
created_date: '2026-05-18 15:26'
labels:
  - bug
  - zond-side
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Bug: `zond db diagnose --api <name> --json` returns failure examples with `reason: null`, while the underlying NDJSON events from `checks run` carry full reason strings. Stamp-down step loses the field. Found 2026-05-18 on live Stripe scan; comparison: NDJSON event has populated reason, diagnose output has null for the same finding.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 diagnose --json failures[].reason is populated when the source event has it
- [ ] #2 test asserts the field round-trips from NDJSON → diagnose output
<!-- AC:END -->
