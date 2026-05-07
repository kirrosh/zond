---
id: TASK-194
title: 'test-helpers: extract tmp-db, fetch-mock, workspace, reporter-fixtures helpers'
status: To Do
assignee: []
created_date: '2026-05-07 10:10'
labels:
  - refactor
  - tests
milestone: m-12
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Создать четыре helper-файла: (1) tests/_helpers/tmp-db.ts с tmpDb(prefix?)+unlinkDb(path) (6 копий tmpDb, 6 копий tryUnlink; tests/cli/init.test.ts течёт без рандом-суффикса). (2) tests/_helpers/fetch-mock.ts с mockFetchSequence/mockFetchOk/mockFetchRouter, каждый возвращает { calls, restore } — заменяет mockFetchResponses в 5 файлах + originalFetch/afterEach обвязку в 16 файлах. (3) tests/_helpers/workspace.ts с makeWorkspace({ prefix?, marker?, chdir? }) — 12 файлов копипастят mkdtempSync+realpathSync+chdir+marker; половина забывает realpathSync (на macOS /var->/private/var баги). (4) tests/_helpers/reporter-fixtures.ts с makeStep(overrides) и makeResult(stepsOrOverrides) — 4 reporter теста.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 tests/_helpers/tmp-db.ts: tmpDb(prefix?), unlinkDb(path) — мигрировано ≥6 файлов
- [ ] #2 tests/_helpers/fetch-mock.ts: mockFetchSequence (throw-on-exhaustion), mockFetchOk, mockFetchRouter — мигрировано ≥10 файлов
- [ ] #3 tests/_helpers/workspace.ts: makeWorkspace всегда realpathSync; ≥8 файлов мигрированы
- [ ] #4 tests/_helpers/reporter-fixtures.ts: makeStep + makeResult overload (array → derive totals); 4 reporter файла
- [ ] #5 tests/cli/init.test.ts больше не использует Date.now() без рандома (collision-fix)
- [ ] #6 Net LOC drop ≥ 350
<!-- AC:END -->
