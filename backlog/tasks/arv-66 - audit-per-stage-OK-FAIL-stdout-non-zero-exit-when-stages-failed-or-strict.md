---
id: ARV-66
title: >-
  audit: per-stage OK/FAIL stdout + non-zero exit when stages failed (or
  --strict)
status: To Do
assignee: []
created_date: '2026-05-11 06:50'
updated_date: '2026-05-16 08:25'
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

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Correction (2026-05-16): prior Implementation Notes line 'Merged ARV-136 (validation-sprint 2026-05-16): run --safe verify-skip cascade' is INCORRECT — ARV-136 is still To Do (separate scope). ARV-66 scope is ONLY:
1. per-stage OK/FAIL stdout next to 'Stage N/M'
2. non-zero exit when any stage failed (or --strict flag)
3. audit-report.html path echoed on success

Do NOT bundle with ARV-136. Verified 2026-05-16: 'zond audit --help' still has no --strict / per-stage status. Keep MEDIUM.
<!-- SECTION:NOTES:END -->
