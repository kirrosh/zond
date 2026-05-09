---
id: TASK-298
title: consolidate validate + lint-spec into zond check
status: Done
assignee: []
created_date: '2026-05-09 07:00'
labels:
  - cli-surface
  - consolidation
  - m-13
  - breaking
milestone: m-13
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Обе команды делают конформанс-проверку (одна — тестов, другая — спеки). Слить в zond check tests/ / zond check spec. Старые команды → deprecated alias на 1 релиз. Эффект: 232 → ~150 LOC, единый ментал-модель. Источник: audit-and-consolidation.md §4 спринт 1.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Команда zond check работает на тестах и спеках (subcommand `check tests` / `check spec`)
- [x] #2 validate / lint-spec удалены без deprecation (по решению пользователя)
- [x] #3 skills/, README, ZOND.md обновлены на check
- [x] #4 CHANGELOG breaking-change запись
<!-- AC:END -->
