---
id: TASK-200
title: 'tests: cover src/core/runner/send-request.ts (no tests today)'
status: Done
assignee: []
created_date: '2026-05-07 10:12'
updated_date: '2026-05-07 12:00'
labels:
  - tests
  - runner
  - coverage
milestone: m-12
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
src/core/runner/send-request.ts (136 строк) не имеет своих тестов. Покрытие только косвенное через executor (1 multipart-кейс). Public surface: resolveAdHocRequest(opts), sendAdHocRequest(opts), extractByPath/jsonPath.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 tests/runner/send-request.test.ts создан, ≥12 кейсов
- [x] #2 resolveAdHocRequest: env merge, base_url auto-prefix (relative + absolute + already-templated), Content-Type auto-detect, extraVars override, missing-collection error
- [x] #3 sendAdHocRequest: jsonPath extraction (dot, [i], missing path → undefined), fetch error propagation
- [x] #4 extractByPath: array OOB, non-numeric index, traversal через null/primitive
- [x] #5 Mock fetch + DB layer; без реальных DB-записей
<!-- AC:END -->
