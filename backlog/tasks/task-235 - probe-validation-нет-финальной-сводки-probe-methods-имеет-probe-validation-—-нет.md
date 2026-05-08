---
id: TASK-235
title: >-
  probe-validation: нет финальной сводки (probe-methods имеет, probe-validation
  — нет)
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
Source: feedback round 02, finding F4, class ux-papercut
Repro: zond probe-validation --api sentry --output apis/sentry/probes 2>&1 | tail -20
Expected: строка вида 'Generated 134 probe-validation suite(s) with N probe(s) in ...' (как у probe-methods)
Actual: поток предупреждений 'Warning: ... may create resources but spec defines no DELETE counterpart', далее сразу Next steps: — счётчика нет
Log: /tmp/zond-fb/sentry/rounds/raw-02.log (=== probe-validation ===)
<!-- SECTION:DESCRIPTION:END -->
