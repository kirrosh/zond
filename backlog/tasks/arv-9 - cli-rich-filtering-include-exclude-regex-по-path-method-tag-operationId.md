---
id: ARV-9
title: 'cli: rich filtering --include / --exclude regex по path/method/tag/operationId'
status: Done
assignee: []
created_date: '2026-05-09 15:47'
updated_date: '2026-05-09 17:39'
labels:
  - cli
  - m-15
  - depth
  - filtering
milestone: m-15
dependencies:
  - ARV-1
priority: medium
---

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Unit-таблица 20 cases: [operations, filter, expected_subset]
- [x] #2 E2E на petstore: фильтр оставляет ровно ожидаемые operations
- [ ] #3 Все 4 команды (run/checks/probe/generate) поддерживают одинаковый синтаксис
- [x] #4 Несовместимые фильтры дают understandable error (не trace)
- [x] #5 Документация в --help у каждой команды
- [ ] #6 Wire --include/--exclude в zond probe (collision с существующим --include на классы probe — нужен renaming) и zond run (alias на --tag) — отложено
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Унифицировать в run / checks / probe / generate:
- `--include path:/users/.*` (regex по path)
- `--include method:GET,POST`
- `--include tag:billing`
- `--include operation-id:getUser*` (glob/regex)
- `--exclude` с тем же синтаксисом, multi-source.

Реализовать как shared util `src/core/utils/operation-filter.ts`. Все 4 команды используют его одинаково.
<!-- SECTION:PLAN:END -->
