---
id: TASK-299
title: consolidate discover + bootstrap into zond prepare-fixtures
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
discover (1254 LOC) и bootstrap имеют пересекающуюся FK-логику. Слить в zond prepare-fixtures [--cascade] [--seed] [--apply] [--verify]. Старые команды → deprecated alias на 1 релиз. Источник: audit-and-consolidation.md §4 спринт 1.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 zond prepare-fixtures покрывает discover и bootstrap флоу
- [ ] #2 Старые команды deprecated с warning
- [ ] #3 skills/, README, scenarios.md обновлены
- [ ] #4 CHANGELOG breaking-change запись
<!-- AC:END -->
