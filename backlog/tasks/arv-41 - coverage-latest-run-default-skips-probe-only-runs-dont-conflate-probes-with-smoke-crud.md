---
id: ARV-41
title: >-
  coverage: latest-run default skips probe-only runs (don't conflate /probes/
  with smoke/crud)
status: To Do
assignee: []
created_date: '2026-05-10 11:36'
labels:
  - feedback-loop
  - api-resend
  - m-16
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Source: feedback round 11, finding F1, class likely_bug
Repro: zond run apis/resend/tests --tag smoke,crud → coverage 39/83 (47%). zond run apis/resend/probes/static → coverage drops to 17/83 (20%) because the new run only hit probe-targeted endpoints.
Expected: when the latest stored run is probe-only (run-source path under apis/<api>/probes/), default coverage falls back to the most recent non-probe run. Otherwise emit a warning ('latest run came from probes/, real test-coverage may be higher — try --union session') so audit's final coverage stage doesn't appear regressed.
Actual: audit pipeline that ends with probe-run → coverage looks like a regression; --fail-on-coverage thresholds break for cosmetic reasons. Tester thinks the DB is broken.
Log: /Users/kirrotech/Projects/zond-test/.fb-loop/rounds/raw-11.log:222 (39/83 pre), :241 (probe-run), :248 (17/83 post)
<!-- SECTION:DESCRIPTION:END -->
