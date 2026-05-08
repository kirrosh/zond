---
id: TASK-234
title: 'skipped reason мусорный: ''Skipped: {{var}} =='''
status: To Do
assignee: []
created_date: '2026-05-08 07:56'
labels:
  - feedback-loop
  - api-sentry
dependencies: []
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Source: feedback round 01, finding F4, class ux-papercut
Repro: zond run apis/sentry/tests/smoke-organizations-positive.yaml (с пустым organization_id_or_slug в .env.yaml)
Expected: 'skipped: required fixture {{organization_id_or_slug}} is empty'
Actual: 'Skipped: {{organization_id_or_slug}} ==' — двойной префикс Skipped: + хвост == без правой части; видно и в console, и в db run (поле error_message)
Log: /tmp/zond-fb/sentry/rounds/raw-01.log (suite organizations-smoke-positive)
<!-- SECTION:DESCRIPTION:END -->
