---
id: TASK-203
title: >-
  tests: fill executor.ts branch gaps (timeout, for_each×parameterize,
  retry_until body, multipart file)
status: To Do
assignee: []
created_date: '2026-05-07 10:12'
labels:
  - tests
  - runner
  - coverage
milestone: m-12
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
tests/runner/executor.test.ts покрывает базовый flow-control. Missing branches: per-step timeout abort, for_each с captured-list, for_each × parameterize cross-product, for_each empty/non-array, set с transform на HTTP-step, set с $generator pinned + reused в retry_until, retry_until body-condition + delay_ms>0 + condition refs captured var, runSuites schemaValidator+networkRetries propagation, provenance merge.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 ≥6 новых тестов в tests/runner/executor.test.ts
- [ ] #2 timeout-abort surfaces step как 'error', не abort'ит suite
- [ ] #3 for_each + captured list in: первый шаг capture'ит, второй iterate'ит
- [ ] #4 for_each × parameterize: N×M результатов, изоляция per-iteration state
- [ ] #5 retry_until body-condition (не status); delay_ms>0 actually waits
- [ ] #6 multipart с file: '@path' читает фикстурный файл и постит Blob
<!-- AC:END -->
