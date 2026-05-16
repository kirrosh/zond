---
id: ARV-130
title: >-
  cleanup: audit discover.ts / bootstrap.ts top-level — drop if subsumed by
  prepare-fixtures
status: Done
assignee: []
created_date: '2026-05-11 10:14'
updated_date: '2026-05-11 10:22'
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
- [x] #1 решение задокументировано: drop / keep + reason
- [x] #2 если drop — файлы удалены, импорты переключены на prepare-fixtures.ts экспорты
- [x] #3 skill'ы не ссылаются на zond discover / zond bootstrap как самостоятельные команды
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Decision: KEEP. discover.ts/bootstrap.ts are NOT top-level CLI commands (verified via grep on src/cli/program.ts — only bootstrapProbes from core/probe/bootstrap.ts is imported, no discoverCommand/bootstrapCommand registration). They are live imperative cores: re-exported from prepare-fixtures.ts and covered by direct unit tests (tests/cli/discover*.test.ts, tests/cli/bootstrap.test.ts). Skills checked — no references to 'zond discover' / 'zond bootstrap' as standalone commands in src/cli/commands/init/templates/skills/. AC#2 condition 'если drop' did not trigger. File-level note added in both source files referencing this ARV-130 audit.
<!-- SECTION:NOTES:END -->
