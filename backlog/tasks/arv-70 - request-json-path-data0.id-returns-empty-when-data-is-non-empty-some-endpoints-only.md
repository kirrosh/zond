---
id: ARV-70
title: >-
  request --json-path data[0].id returns empty when data is non-empty (some
  endpoints only)
status: Done
assignee: []
created_date: '2026-05-11 07:05'
updated_date: '2026-05-11 07:07'
labels:
  - feedback-loop
  - api-resend
  - m-16
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Source: feedback round 02, finding F11, class definitely_bug. Repro: zond request GET /segments --api resend --json-path 'data[0].id' → '' (empty stdout); zond request GET /segments --api resend (no --json-path) shows data[0].id is a real uuid; zond request GET /domains --api resend --json-path 'data[0].id' works. Expected: --json-path data[0].id returns the first element id. Actual: empty stdout on some endpoints despite identical response shape. Impact: user cannot reliably script harvest via --json-path (tester lost 10min debugging). Log: ~/Projects/zond-test/.fb-loop/rounds/raw-02.log
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 extractByPath gains a diagnostic variant that records the resolved chain and pinpoints the failing segment + reason
- [x] #2 request --json-path prints a hint on stderr (zond: --json-path '…' did not resolve …) when the result is undefined
- [x] #3 diagnostic distinguishes missing-key (lists actual keys), out-of-bounds (cites length), and string-body (hints content-type) cases
- [x] #4 regression tests cover happy path + each failure-class with the diagnostic
<!-- AC:END -->
