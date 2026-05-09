---
id: TASK-289
title: rename run --no-real-parents to --use-synthetic-parents
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
Двойное отрицание путает; флаг используется редко. Переименовать в --use-synthetic-parents либо удалить, если поведение по умолчанию покрывает кейс. Источник: audit-and-consolidation.md §3.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Старый флаг --no-real-parents выводит deprecation warning и алиасит на новый
- [ ] #2 Документация обновлена
- [ ] #3 CHANGELOG.md запись
<!-- AC:END -->
