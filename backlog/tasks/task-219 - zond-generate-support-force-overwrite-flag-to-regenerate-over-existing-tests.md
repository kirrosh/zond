---
id: TASK-219
title: >-
  zond generate: support --force/--overwrite flag to regenerate over existing
  tests
status: To Do
assignee: []
created_date: '2026-05-07 14:53'
labels:
  - feedback-loop
  - api-resend
dependencies: []
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Source: feedback round 03 (verify), finding FV1, class ux-papercut. Repro: zond generate ... --force -> error: unknown option '--force'; --overwrite same. Expected: flag for forced regeneration over existing files (currently must rm -rf tests/). Actual: without flag generate skips existing files (manifest), no explicit way to regenerate except removing tests/ dir. Log: /tmp/zond-fb/resend/rounds/raw-03.log
<!-- SECTION:DESCRIPTION:END -->
