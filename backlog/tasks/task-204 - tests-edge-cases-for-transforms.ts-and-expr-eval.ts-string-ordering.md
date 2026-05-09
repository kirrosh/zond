---
id: TASK-204
title: 'tests: edge cases for transforms.ts and expr-eval.ts (string ordering)'
status: To Do
assignee: []
created_date: '2026-05-07 10:12'
labels:
  - tests
  - runner
  - coverage
milestone: m-14
dependencies: []
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
tests/runner/transforms.test.ts: edge cases не покрыты (get OOB / negative index / missing key / type-mismatch, length number/object → 0, append с <2 args, concat non-array, map_field missing field / non-object, first non-array). tests/runner/expr-eval.test.ts: лексикографика '>'/'<' на строках, операторный pitfall (!= перед == в OPERATORS), '0' == '' quirk.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 transforms: ≥10 новых edge-кейсов с pin'ом текущего поведения (для guard'а на refactor)
- [ ] #2 expr-eval: ≥5 новых кейсов на string-ordering, !=/== precedence, '0' vs '' quirk
<!-- AC:END -->
