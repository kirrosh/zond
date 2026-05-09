---
id: TASK-286
title: drop zond export postman (per decision-4)
status: Done
assignee: []
created_date: '2026-05-09 06:59'
labels:
  - cleanup
  - cli-surface
  - m-13
  - breaking
milestone: m-13
dependencies: []
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
decision-4 решает удалить export postman: OpenAPI уже всё описывает, нишевая фича без потребителей. Удалить src/cli/commands/export*.ts (postman-часть), флаги, тесты, документацию. Источник: audit-and-consolidation.md §3, decisions/decision-4.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Команда export postman удалена
- [ ] #2 Тесты удалены
- [ ] #3 decision-4 переведён в статус Implemented
<!-- AC:END -->
