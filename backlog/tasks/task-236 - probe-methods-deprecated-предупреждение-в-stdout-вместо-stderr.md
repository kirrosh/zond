---
id: TASK-236
title: 'probe-methods: deprecated-предупреждение в stdout вместо stderr'
status: To Do
assignee: []
created_date: '2026-05-08 07:57'
labels:
  - feedback-loop
  - api-sentry
dependencies: []
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Source: feedback round 02, finding F5, class ux-papercut
Repro: zond probe-methods --api sentry --output apis/sentry/probes 2>&1 | head -1
Expected: deprecation banner в stderr, не stdout
Actual: первая строка stdout — '[zond] probe-methods is deprecated, use zond probe methods instead' — смешано с обычным выводом, ломает machine-парсинг
Log: /tmp/zond-fb/sentry/rounds/raw-02.log (=== probe-methods ===)
<!-- SECTION:DESCRIPTION:END -->
