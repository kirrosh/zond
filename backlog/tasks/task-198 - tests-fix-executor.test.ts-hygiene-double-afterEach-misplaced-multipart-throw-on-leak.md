---
id: TASK-198
title: >-
  tests: fix executor.test.ts hygiene (double afterEach, misplaced multipart,
  throw-on-leak)
status: To Do
assignee: []
created_date: '2026-05-07 10:10'
labels:
  - refactor
  - tests
  - runner
milestone: m-12
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
tests/runner/executor.test.ts: (1) L645-647 второй afterEach внутри describe('setup suite propagation') — redundant с L10. (2) L709-740 тест 'sends multipart/form-data with text fields' лежит внутри describe 'setup suite propagation' — мисплейс. (3) L14-23 mockFetchResponses 500-fallback при exhaustion маскирует утечки fetch между тестами — заменить на throw. (4) tests/runner/parameterize.test.ts L144-152 импортирует validateSuite — кросс-слойный тест, перенести в tests/parser/schema.test.ts.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 L645-647 inner afterEach удалён
- [ ] #2 Multipart-тест перемещён в свой top-level describe('multipart')
- [ ] #3 mockFetchResponses бросает 'unexpected fetch call (call N)' вместо 500-fallback
- [ ] #4 parameterize.test.ts L144-152 'schema accepts parameterize map' перенесён в tests/parser/schema.test.ts
- [ ] #5 Зелёное
<!-- AC:END -->
