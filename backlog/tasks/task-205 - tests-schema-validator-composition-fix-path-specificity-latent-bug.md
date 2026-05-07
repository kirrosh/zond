---
id: TASK-205
title: 'tests: schema-validator composition + fix path-specificity latent bug'
status: Done
assignee: []
created_date: '2026-05-07 10:12'
updated_date: '2026-05-07 12:00'
labels:
  - tests
  - runner
  - coverage
  - bug
milestone: m-12
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
src/core/runner/schema-validator.ts L58: комментарий обещает 'concrete /users/me wins over /users/{id}', но реализация — endpoints.find в spec-iteration order без specificity sort. Латентный баг. Также не покрыты oneOf/anyOf/allOf, additionalProperties:false, pattern, minLength/minimum, multipleOf, const, malformed-schema compile error path.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Regression test: concrete /users/me найден ДО /users/{id} в spec — текущая impl падает; либо fix iteration (sort by specificity), либо явная документация ограничения и тест на текущее поведение
- [x] #2 ≥8 новых кейсов: oneOf/anyOf/allOf, additionalProperties:false, pattern, minLength+minimum, const, multipleOf, compile-error returns single 'schema.compile_error' assertion, missing-path returns []
<!-- AC:END -->
