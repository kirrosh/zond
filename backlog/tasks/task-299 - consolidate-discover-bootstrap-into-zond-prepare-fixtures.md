---
id: TASK-299
title: consolidate discover + bootstrap into zond prepare-fixtures
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
discover (1254 LOC) и bootstrap имеют пересекающуюся FK-логику. Слить в zond prepare-fixtures [--cascade] [--seed] [--apply] [--verify]. Старые команды → deprecated alias на 1 релиз. Источник: audit-and-consolidation.md §4 спринт 1.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 zond prepare-fixtures покрывает discover (default) и bootstrap (--cascade) флоу
- [x] #2 Старые команды удалены без deprecation (по решению пользователя)
- [x] #3 skills/, README, ZOND.md, audit обновлены
- [x] #4 CHANGELOG breaking-change запись
<!-- AC:END -->
