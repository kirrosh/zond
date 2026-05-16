---
id: ARV-71
title: >-
  coverage default = latest run is footgun; auto-union when zond session is
  active (or warn)
status: Done
assignee: []
created_date: '2026-05-11 07:05'
updated_date: '2026-05-11 07:09'
labels:
  - feedback-loop
  - api-resend
  - m-16
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Source: feedback round 02, finding F12, class ux-papercut. Repro: zond run … (run #6, large) ; manual .env.yaml edit ; zond run … (run #7, partial) ; zond coverage --api resend → pass 39% (was 77%); zond coverage --api resend --union since:1h → 78%. Expected: if --api X and there is an active zond session, default to --union session; otherwise zond run final summary should print 'Coverage will be measured against run #N; pass --union for aggregate'. Actual: latest-run default looks like a regression after each new run; --help explains it but the warning is not surfaced. Log: ~/Projects/zond-test/.fb-loop/rounds/raw-02.log
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 coverage default = --union session when --api X is set, a zond session is active, and the session has >1 runs
- [x] #2 stderr footer announces the auto-promotion ('active session has N runs — defaulting to --union session')
- [x] #3 explicit selectors (--run-id, --union, --session-id) win — no auto-promotion when user pinned a slice
- [x] #4 --json mode does not write the announcement (envelope stays clean)
- [x] #5 no behaviour change when there is no active session or session has only one run
<!-- AC:END -->
