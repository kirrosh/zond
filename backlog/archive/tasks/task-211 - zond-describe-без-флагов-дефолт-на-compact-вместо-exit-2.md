---
id: TASK-211
title: 'zond describe без флагов: дефолт на --compact вместо exit 2'
status: Done
assignee: []
created_date: '2026-05-07 14:08'
updated_date: '2026-05-07 15:37'
labels:
  - feedback-loop
  - api-resend
dependencies: []
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Source: feedback round 01, finding F3, class ux-papercut
Repro: zond describe --api resend -> Error: Missing --method and --path. Use --compact for all endpoints, or specify --method and --path for one.
Expected: zond describe --api <name> без флагов -> показывает compact-листинг (или мягко предлагает --compact без exit 2)
Actual: exit 2, ошибка в stderr -> ломает скрипты которые ждут листинг
Log: /tmp/zond-fb/resend/rounds/raw-01.log
<!-- SECTION:DESCRIPTION:END -->
