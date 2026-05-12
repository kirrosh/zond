---
id: ARV-72
title: >-
  run: exit non-zero when any step failed (or document --report-out gating
  exit-status)
status: Done
assignee: []
created_date: '2026-05-11 07:05'
updated_date: '2026-05-11 07:11'
labels:
  - feedback-loop
  - api-resend
  - m-16
dependencies: []
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Source: feedback round 02, finding F14, class ux-papercut. Repro: zond run apis/resend/tests … → 545 failed steps, exit_code=0. Expected: --quiet help advertises exit 1 on fail. Actual: 516 fail out of 1381 → exit 0. CI won't catch this. Possibly --report-out / --report json suppress exit status. Ask: explicit --fail-on-failures (parity with coverage) or document the --report-out gating. Log: round-02 raw
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 stderr tail prints 'N test step(s) failed — exiting with code 1' so wrappers that eat exit codes can still be audited from the log
- [x] #2 default exit 1 behaviour preserved; --no-fail-on-failures forces exit 0 for advisory runs
- [x] #3 behaviour skipped in --json (envelope-only mode) and dry-run
- [x] #4 regression test: failing fixture → exit 1 by default and 0 with --no-fail-on-failures; stderr line present in both
<!-- AC:END -->
