---
id: ARV-247
title: >-
  probe security --emit-tests: создавать директорию когда есть HIGH
  (2xx-with-echo) даже без 'No 2xx findings'
status: Done
assignee: []
created_date: '2026-05-15 05:42'
updated_date: '2026-05-15 05:47'
labels:
  - feedback-loop
  - api-github
  - m-16
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Source: feedback round 04, finding F18, class likely_bug
Repro: round-04 → 4 HIGH stored injection findings (все 2xx с echoed payload: S1 200, S2 200, S3 201, S4 200) + сообщение 'No 2xx findings to emit. Directory apis/github/probes/security not created.'
Expected: HIGH findings — это 2xx с echoed payload по определению (server accepted attack). --emit-tests должен записать regression yaml для каждого HIGH.
Actual: yaml не записан → нельзя CI-фиксировать HIGH через zond run probes/security.
Likely root cause: condition '2xx findings to emit' проверяет только некоторую категорию, не HIGH-stored-injection.
Log: ~/Projects/zond-test/.fb-loop/rounds/security-digest-04.md (summary line)
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 emitSecurityRegressionSuites emits suites for HIGH verdicts (severity in {ok, low, high}); HIGH findings use ATTACK_EXPECTED_STATUS (rejected) so the regression suite goes green only when the API rejects the payload
<!-- AC:END -->
