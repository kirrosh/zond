---
id: TASK-298
title: consolidate validate + lint-spec into zond check
status: To Do
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
- [ ] #1 Команда zond check работает на тестах и спеках (subcommand или auto-detect)
- [ ] #2 validate / lint-spec deprecated с warning
- [ ] #3 skills/, README обновлены на check
- [ ] #4 CHANGELOG breaking-change запись
<!-- AC:END -->
