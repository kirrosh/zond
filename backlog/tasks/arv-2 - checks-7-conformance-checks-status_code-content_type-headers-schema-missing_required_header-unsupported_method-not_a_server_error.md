---
id: ARV-2
title: >-
  checks: 7 conformance checks
  (status_code/content_type/headers/schema/missing_required_header/unsupported_method/not_a_server_error)
status: To Do
assignee: []
created_date: '2026-05-09 15:46'
labels:
  - checks
  - m-15
  - depth
  - conformance
dependencies:
  - ARV-1
milestone: m-15
priority: high
---

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Все 7 checks зарегистрированы и видны в zond checks list
- [ ] #2 Каждый check имеет fixture-based unit-тест с минимум 3 кейсами (ok/fail/edge)
- [ ] #3 response_schema_conformance переиспользует runner/schema-validator.ts без дублирования
- [ ] #4 unsupported_method разделяет код с method-probe через shared util
- [ ] #5 Integration-тест: mock-server с инжектированным 502 → not_a_server_error выдаёт finding с правильным severity
- [ ] #6 Edge-тест: response с 'default' в spec для status_code_conformance — не считается finding'ом
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Имена 1-в-1 со schemathesis. По одному файлу на check в `src/core/checks/checks/`, каждый ≤80 LOC.

- `not_a_server_error`: response.status >= 500 OR malformed JSON. Default: non-5xx.
- `status_code_conformance`: код не описан в spec и нет `default`.
- `content_type_conformance`: Content-Type отсутствует / не из spec responses.
- `response_headers_conformance`: header values не валидны по их JSON Schema.
- `response_schema_conformance`: тело не валидно по JSON Schema. Reuse `runner/schema-validator.ts`.
- `missing_required_header`: запрос без обязательного header принят. Default expected: 400/401/403/406/422.
- `unsupported_method`: undefined HTTP method не вернул 405. Reuse logic из `core/probe/method-probe.ts` (вынести в shared util).
<!-- SECTION:PLAN:END -->
