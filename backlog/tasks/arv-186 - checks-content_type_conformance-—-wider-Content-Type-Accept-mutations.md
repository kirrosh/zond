---
id: ARV-186
title: 'checks: content_type_conformance — wider Content-Type/Accept mutations'
status: To Do
assignee: []
created_date: '2026-05-13 09:17'
updated_date: '2026-05-16 10:55'
labels:
  - parity-fix
  - deferred
  - feature-m-22
dependencies: []
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Цель

Закрыть schemathesis-only gap по `content_type_conformance` (Stripe:
10 endpoints в overlap'е).

## Проблема

Schemathesis V4 в coverage-фазе генерирует cases с **намеренно неправильным**
Content-Type (на POST/PUT/PATCH) или **намеренно неправильным** Accept
(на GET). Сервер либо обрабатывает запрос успешно (Content-Type ignore →
documented Content-Type не вернул) — `content_type_conformance` fail.

Zond пока шлёт только positive cases с правильным Content-Type =
op.requestBodyContentType. Что вернул сервер — проверяется на response-
side, но triggering случаев недостаточно.

## Что выяснить (брейншторм)

- schemathesis V4 source: `schemathesis/generation/coverage.py` — какие
  сценарии Content-Type/Accept перебираются.
- В zond уже есть `requestBodyContentType` на EndpointInfo и
  `responseContentTypes`. Можно ли cheaply генерить cross-product
  «известных» MIME (application/json ↔ application/xml ↔ text/plain)?
- Anti-FP: сервер может legitimately возвращать другой content-type
  на 4xx (например `application/problem+json`). Текущая проверка
  `contentTypeConformance` это учитывает? проверить.

## Скоуп

- Coverage-phase generator для headers: эмитит case'ы с mutated
  Content-Type для body-bearing methods, mutated Accept для GET.
- Возможно — `caseKinds: ["positive", "negative_data"]` для
  content_type_conformance (как ARV-180 сделал для status_code).

## Замер

После: ожидаемая дельта на Stripe overlap — 1 → ~10 (паритет).

## Приоритет

Low. content_type_conformance — medium-severity, и 10 endpoint'ов на
Stripe — это документация-shape issue, не security. Делать после
финализации m-18.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Content-Type/Accept mutation case-generation в coverage-фазе
- [ ] #2 anti-FP: legitimate type variations на 4xx responses не fail'ят
- [ ] #3 parity-замер на Stripe: 1 → ≥8 findings content_type_conformance
<!-- AC:END -->
