---
id: TASK-285
title: drop zond update command (use brew/npm)
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
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Self-update лучше делать через системный пакет-менеджер. Удалить команду update, заменить инструкциями в README (brew upgrade zond, bun install -g, etc). Источник: audit-and-consolidation.md §3.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Команда update удалена
- [ ] #2 README содержит секцию upgrade с brew/npm/bun
- [ ] #3 CHANGELOG.md breaking-change запись
<!-- AC:END -->
