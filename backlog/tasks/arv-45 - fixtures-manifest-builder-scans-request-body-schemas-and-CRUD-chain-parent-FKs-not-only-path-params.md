---
id: ARV-45
title: >-
  fixtures-manifest: builder scans request-body schemas and CRUD-chain
  parent-FKs, not only path-params
status: To Do
assignee: []
created_date: '2026-05-10 18:43'
labels:
  - m-17
  - fixtures
  - manifest
  - agent-contract
dependencies: []
priority: high
milestone: m-17
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Source: feedback-13 F2 (medium). На resend: 14 fixtures в .api-fixtures.yaml, но сгенерированные тесты ссылаются на 18 vars — generator вставляет {{broadcast_id}}, {{contact_property_id}}, {{event_id}}, {{template_id}}, {{topic_id}} в request bodies через resources-map / data-factory, а manifest builder этого не предсказывает. .api-fixtures.yaml перестаёт быть источником правды — discover работает по .env.yaml, и расхождение копится. Эта задача возвращает manifest в роль единственного source-of-truth о списке (per decision-7).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 После `zond add api X` manifest содержит каждую var, на которую generator реально будет ссылаться (path-params + parent-FK из request bodies + capture-chain inputs)
- [ ] #2 Каждая запись имеет корректный source: path | body-fk (новый) | header | auth | server
- [ ] #3 На resend: manifest после add-api содержит >=18 fixtures (включая broadcast_id, template_id, topic_id, contact_property_id, event_id)
- [ ] #4 Idempotent: zond refresh-api не создаёт дубликатов и не меняет существующие descriptions/affectedEndpoints без причины
- [ ] #5 Regression fixture-test: mock spec с POST /A {body: {b_id: ref}}, POST /B → manifest содержит b_id с source: body-fk и affectedEndpoints: [POST /A]
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. core/generator/fixtures-builder.ts расширяет input: помимо extractEndpoints, проходит resourceMap (CRUD-chains + body parent-FK) и data-factory heuristic'и.\n2. Новый source 'body-fk' в FixtureSourceKind.\n3. Дедуп: одна var может появляться и в path, и в body — выбираем 'path' (более ограничивающий), affectedEndpoints мерджим.\n4. Тест tests/core/generator/fixtures-builder.test.ts: cases на body-fk, capture-chain, source-precedence.
<!-- SECTION:PLAN:END -->
