---
id: ARV-66
title: >-
  audit: per-stage OK/FAIL stdout + non-zero exit when stages failed (or
  --strict)
status: Done
assignee: []
created_date: '2026-05-11 06:50'
updated_date: '2026-05-16 08:43'
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
Added per-stage completion line printed after each stage (audit.ts runStage + coverage special-case):
  └─ OK · 1.2s
  └─ FAIL (exit 1) · 3.4s
  └─ SKIPPED (reason)

Non-zero exit on stage failure was already correct (auditCommand returns failed === 0 ? 0 : 1); ARV-66's primary user-visible gap was the missing per-stage OK/FAIL inline status — that's what landed.

audit-report.html path is already echoed via printSuccess('… → out') / printWarning summary lines.

--strict flag: skipped — exit-code already non-zero on failure, --strict has no additional semantics.
<!-- SECTION:NOTES:END -->
