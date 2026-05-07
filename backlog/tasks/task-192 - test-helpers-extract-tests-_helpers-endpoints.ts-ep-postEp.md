---
id: TASK-192
title: 'test-helpers: extract tests/_helpers/endpoints.ts (ep + postEp)'
status: Done
assignee: []
created_date: '2026-05-07 10:09'
updated_date: '2026-05-07 10:38'
labels:
  - refactor
  - tests
milestone: m-12
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Девять файлов под tests/core/probe/, tests/core/coverage-reasons.test.ts и tests/integration/probe-cleanup.test.ts держат локальную копию 'function ep(partial)' с расходящимися дефолтами (method, requestBodyContentType, responses). Вынести каноническое определение в tests/_helpers/endpoints.ts (ep + convenience postEp), удалить 9 копий. ~150 строк.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 tests/_helpers/endpoints.ts экспортирует ep(partial?) и postEp(partial?)
- [ ] #2 grep -c 'function ep' tests/core/probe/*.test.ts == 0 после миграции
- [ ] #3 9 файлов мигрированы, импортируют из _helpers
- [ ] #4 bun test зелёное, тест-каунт без изменений
<!-- AC:END -->
