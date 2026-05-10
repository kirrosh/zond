---
id: ARV-39
title: >-
  zond run <missing-file>: trim trailing whitespace + suggest directory form on
  ENOENT
status: To Do
assignee: []
created_date: '2026-05-10 11:30'
labels:
  - feedback-loop
  - api-resend
  - m-16
dependencies: []
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Source: feedback round 10, finding F3, class ux-papercut
Repro: zond run apis/resend/tests/no-such.yaml → 'ENOENT ... open "apis/resend/tests/no-such.yaml "' (trailing space).
Expected: clean Node error sans whitespace + 'did you mean apis/resend/tests/' or 'known suites: ...'.
Actual: bare ENOENT with whitespace artifact in the path quote.
Log: /Users/kirrotech/Projects/zond-test/.fb-loop/rounds/raw-10.log:387
<!-- SECTION:DESCRIPTION:END -->
