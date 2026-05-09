---
id: ARV-3
title: >-
  checks: 3 security checks (ignored_auth, use_after_free,
  ensure_resource_availability)
status: To Do
assignee: []
created_date: '2026-05-09 15:46'
labels:
  - checks
  - m-15
  - depth
  - security
dependencies:
  - ARV-1
milestone: m-15
priority: high
---

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 ignored_auth: 3-вариантный probe реализован с anti-FP guards (security:[] override, broken baseline)
- [ ] #2 use_after_free / ensure_resource_availability работают на petstore mock с CRUD-chain
- [ ] #3 Unit-таблица tests/core/checks/ignored-auth.test.ts: [scheme, baseline, no_auth, bogus, expected]
- [ ] #4 Integration: mock с broken auth (всегда 200) → ignored_auth выдаёт HIGH finding
- [ ] #5 Integration: mock-сценарий 'leak after delete' (200 после DELETE) → use_after_free fail
- [ ] #6 Когда bootstrap-cleanup помечен failed — security checks автоматически skip с warning
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
- `ignored_auth`: для operation с security-требованием делаем 3 запроса: (1) real auth = baseline, (2) без header, (3) bogus token того же scheme (Bearer/Basic/apiKey). Если (2) или (3) ≠ 401/403 → fail. Skip operations с `security: []` override. Skip если baseline ≠ 2xx (broken baseline).
- `use_after_free`: требует CRUD-chain из `apis/<name>/.api-resources.yaml`. Создаём ресурс → удаляем → GET ожидаем 404/410.
- `ensure_resource_availability`: создаём → GET по id → ожидаем 2xx.

Anti-FP guards (критично):
- skip apiKey-в-query на public endpoints,
- skip если bootstrap-cleanup упал (передать через context flag),
- skip endpoints где даже real auth даёт 401/403.
<!-- SECTION:PLAN:END -->
