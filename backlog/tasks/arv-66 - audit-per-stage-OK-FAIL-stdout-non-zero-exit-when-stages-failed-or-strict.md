---
id: ARV-66
title: >-
  audit: per-stage OK/FAIL stdout + non-zero exit when stages failed (or
  --strict)
status: To Do
assignee: []
created_date: '2026-05-11 06:50'
labels:
  - feedback-loop
  - api-resend
  - m-16
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Source: feedback round 01, finding F6, class likely_bug. Repro: zond audit --api resend → 'Warning: 3 failed: session-start, run-tests, run-probes' with exit_code=0. Expected: non-zero exit when stages failed; clear per-stage OK/FAIL lines in stdout next to 'Stage N/7'. Actual: exit 0, single-line summary, audit-report.html path not shown. session-start 'failed' is suspicious (relates to F5/ARV-65). Ask: per-stage status lines + non-zero exit or --strict flag. Log: ~/Projects/zond-test/.fb-loop/rounds/raw-01.log
<!-- SECTION:DESCRIPTION:END -->
