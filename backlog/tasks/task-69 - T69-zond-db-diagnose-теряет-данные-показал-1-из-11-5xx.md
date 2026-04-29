---
id: TASK-69
title: 'T69: zond db diagnose теряет данные (показал 1 из 11 5xx)'
status: To Do
assignee: []
created_date: '2026-04-29 08:38'
labels:
  - bug
  - diagnose
  - critical
milestone: m-3
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Контекст

Round 2: в run #5 (probe-validation) реально 11 5xx, но `zond db diagnose 5 --json` показал 1. Пользователь поверит первой цифре и пропустит 10 из 11 багов. Silent data loss в инструменте, который продаётся как «диагностика».

Гипотеза: diagnose обрезает по top-N либо фильтрует по failure_type=api_error, в то время как большинство 5xx zond помечает assertion_failed (потому что сравнивает со списком ожидаемых статусов).

Сравнение: diagnose 5xx COUNT 1 vs db run --json 5xx COUNT 11.

## Что сделать

1. Снять truncation либо явно показывать «showing 1 of 11, run with --all».
2. Классификация failure_type для 5xx не должна терять находки (5xx внутри assertion_failed считается тоже).
3. JSON-output включает все, не sample.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 zond db diagnose <id> показывает все 5xx-failures, не sample
- [ ] #2 Если применяется кластеризация — общий счётчик показывается отдельно от cluster-summary
- [ ] #3 Тест регрессии: diagnose count == db run --json count для класса 5xx
<!-- AC:END -->
