---
id: ARV-340
title: >-
  not_a_server_error blind to input-triggered 5xx (defaults to positive-only
  caseKinds)
status: Done
assignee: []
created_date: '2026-07-06 10:51'
updated_date: '2026-07-06 14:06'
labels:
  - zond-bug
  - checks
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Evidence: live Stripe audit 2026-07-06 (run 20260706-130102). GET /v1/billing/alerts returned HTTP 500 x4 on malformed query input, but zond emitted ZERO findings.

Root cause: not_a_server_error declares no caseKinds, so runner.ts:512-514 defaults it to ["positive"]. It only evaluates well-formed requests. The 500 was produced by a negative_data param mutation; negative_data_rejection/status_code_conformance ran on that case but score non-2xx as pass, so the 5xx slips through.

Fix: not_a_server_error.caseKinds = ["positive","negative_data","missing_required_header"] (NOT unsupported_method — 501/405 there is legitimate). A malformed input to a real op must never yield 5xx.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 not_a_server_error evaluates negative_data and missing_required_header responses
- [ ] #2 a 5xx from a negative_data case produces a HIGH finding
- [ ] #3 unsupported_method cases still excluded (no 501 noise)
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Landed earlier (see git log: 8f8846a ARV-340/341, 513ad26 ARV-342). Backlog status was stale; marking Done.
<!-- SECTION:NOTES:END -->
