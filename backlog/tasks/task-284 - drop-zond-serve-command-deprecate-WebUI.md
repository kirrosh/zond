---
id: TASK-284
title: drop zond serve command (deprecate WebUI)
status: To Do
assignee: []
created_date: '2026-05-09 06:59'
labels:
  - cleanup
  - cli-surface
  - m-13
  - breaking
milestone: m-13
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
WebUI полузаброшен; vector-3 явно про agent-first без UI. Удалить команду serve, src/cli/commands/serve.ts, src/web/ если используется только serve. Deprecation warning один релиз → удалить. CHANGELOG breaking-change запись. Источник: audit-and-consolidation.md §3, vector-3.md §1, §11.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 serve команда выводит deprecation warning в текущем релизе
- [ ] #2 Документация (README, ZOND.md, skills/) не упоминает serve как поддерживаемую
- [ ] #3 CHANGELOG.md breaking-change запись
<!-- AC:END -->
