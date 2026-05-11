---
id: ARV-130
title: >-
  cleanup: audit discover.ts / bootstrap.ts top-level — drop if subsumed by
  prepare-fixtures
status: To Do
assignee: []
created_date: '2026-05-11 10:14'
labels:
  - m-19
  - cleanup
  - breaking-change
dependencies: []
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
§5/G refactor-plan. Проверить src/cli/commands/discover.ts и bootstrap.ts: после спринта 1 audit-and-consolidation они должны были слиться в prepare-fixtures. Top-level файлы могут быть мёртвыми aliases или живым code-path'ом.

Шаги:
1. grep regs в program.ts — зарегистрированы ли как top-level commands?
2. Если deprecated aliases — drop без warning.
3. Если живой code-path — задокументировать, почему остались отдельно.
4. Если subsumed но кто-то импортирует функции — рефакторить import'ы.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 решение задокументировано: drop / keep + reason
- [ ] #2 если drop — файлы удалены, импорты переключены на prepare-fixtures.ts экспорты
- [ ] #3 skill'ы не ссылаются на zond discover / zond bootstrap как самостоятельные команды
<!-- AC:END -->
