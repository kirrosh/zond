---
id: TASK-83
title: 'T83: --stop-on / --bail-on по классу failure'
status: To Do
assignee: []
created_date: '2026-04-29 08:41'
labels:
  - runner
  - ux
milestone: m-3
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Контекст

`--bail` останавливает на первом FAILED **suite** — но на пробах сьют редко падает целиком, обычно 1-2 теста из 50. На ловле 5xx-багов хочется остановиться на первом 500 чтобы дать diagnose немедленно.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 --stop-on 5xx останавливает run на первом 500-ответе
- [ ] #2 --stop-on api-error для network/parse/runtime (zond-bug class — см. T84)
- [ ] #3 --bail (existing) — на первом FAILED suite
- [ ] #4 Документация
<!-- AC:END -->
