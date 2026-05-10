---
id: ARV-19
title: 'coverage: include checks-run hits or document the gap'
status: To Do
assignee: []
created_date: '2026-05-10 07:22'
labels:
  - feedback-loop
  - api-resend
  - m-16
dependencies: []
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Source: feedback round 02, finding F3, class missing-feature
Repro: zond run (14 ops) + zond checks run (30 ops) → zond coverage still shows 14/83 (17%).
Expected: either hit-coverage folds in probe-runs, or coverage exposes --include-checks / --source checks for separate aggregation. Right now nothing in --help/docstring says probes don't count.
Actual: coverage ledger silently ignores checks run; tester thinks probes don't hit endpoints.
Log: /Users/kirrotech/Projects/zond-test/.fb-loop/rounds/raw-02.log
<!-- SECTION:DESCRIPTION:END -->
