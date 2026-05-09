---
id: TASK-234
title: 'skipped reason мусорный: ''Skipped: {{var}} =='''
status: Done
assignee: []
created_date: '2026-05-08 07:56'
updated_date: '2026-05-09 09:13'
labels:
  - feedback-loop
  - api-sentry
milestone: m-14
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Source: feedback round 01, finding F4, class ux-papercut
Repro: zond run apis/sentry/tests/smoke-organizations-positive.yaml (с пустым organization_id_or_slug в .env.yaml)
Expected: 'skipped: required fixture {{organization_id_or_slug}} is empty'
Actual: 'Skipped: {{organization_id_or_slug}} ==' — двойной префикс Skipped: + хвост == без правой части; видно и в console, и в db run (поле error_message)
Log: /tmp/zond-fb/sentry/rounds/raw-01.log (suite organizations-smoke-positive)
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Closed as duplicate: bug 'Skipped: {{var}} ==' fixed by TASK-237 (commit f1a4e57). Regression test added in tests/runner/executor.test.ts (skip_if '{{var}} ==' with empty var produces friendly reason).
<!-- SECTION:NOTES:END -->
