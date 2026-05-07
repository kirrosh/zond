---
id: TASK-193
title: 'test-helpers: extract captureOutput() in tests/_helpers/output.ts'
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
17 файлов в tests/cli/* (program, ci-init, catalog, init, run-report-out, db, commands, run-zond-current-fallback, run-cwd-env-fallback, request, describe, safe-run, update, run-tag-parse-errors, use, run-sequential) и tests/reporter/junit держат свою версию suppressOutput()/captureLog() — три флавора (mute-only, capture-string, capture-chunks). Унифицировать в captureOutput({ console? }) -> { restore, out, err, outChunks, errChunks }.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 tests/_helpers/output.ts экспортирует captureOutput с опцией console?: boolean (для console.log/error патчинга)
- [ ] #2 Все 17 файлов используют общий helper; локальные suppressOutput/captureLog удалены
- [ ] #3 bun test tests/cli tests/reporter зелёное
- [ ] #4 Net LOC drop ≥ 150
<!-- AC:END -->
