---
id: ARV-333
title: >-
  not_a_server_error skips negative-mutation/coverage GET requests — live 5xx
  invisible
status: To Do
assignee: []
created_date: '2026-07-03 19:25'
labels:
  - checks
  - detection-gap
  - not_a_server_error
  - evidence-backed
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Found on Stripe zond-audit run 20260703-215536 (raw/30-checks.ndjson). GET /v1/billing/alerts?ending_before=12345 (malformed cursor) returned live HTTP 500. The two check_result events for that request are negative_data_rejection (pass) and status_code_conformance (pass); NO finding was emitted. not_a_server_error ran 337x on that operation but only on its POST paths (all 400s) — it never evaluated the negative-mutation GET that actually 500'd. So the single genuine server error in the whole run was invisible to zond and had to be grepped out of raw by status code. Two defects: (a) not_a_server_error is not dispatched on coverage/negative-mutation GET requests; (b) status_code_conformance passed a 500 for this op (declared list did not include 500, yet no violation fired — cross-check against ARV-285 matrix which should mark undeclared 5xx HIGH).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 not_a_server_error is evaluated on every request that receives a response, including negative-mutation and coverage-phase GET requests
- [ ] #2 a live 5xx on a negative-mutation GET emits a HIGH finding (repro: GET /v1/billing/alerts?ending_before=12345 against Stripe)
- [ ] #3 regression check: replaying the 20260703-215536 Stripe NDJSON surfaces the billing/alerts 500 as a finding
<!-- AC:END -->
