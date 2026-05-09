---
id: TASK-290
title: global --api flag + ZOND_API env + .zond/current-api
status: Done
assignee: []
created_date: '2026-05-09 06:59'
labels:
  - cli-surface
  - ergonomics
  - m-13
milestone: m-13
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Сейчас --api повторяется в ~15 командах. Сделать глобальный флаг (preAction в commander), env ZOND_API, файл .zond/current-api (через zond use <name>). Per-command --api оставить как override. Эффект: ~750 LOC меньше дублирования. Источник: audit-and-consolidation.md §4.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Глобальный --api работает на всех командах с --api
- [ ] #2 ZOND_API env читается
- [ ] #3 zond use <name> обновляет .zond/current-api
- [ ] #4 Per-command --api переопределяет глобальное значение
<!-- AC:END -->
