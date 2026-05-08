---
id: TASK-243
title: 'generator: CRUD body содержит junk (id: {{$uuid}}, key1/key2 от additionalProperties, hanging null) — POST везде fail'
status: Done
assignee: []
created_date: '2026-05-08 13:00'
updated_date: '2026-05-08 13:30'
labels:
  - feedback-loop
  - api-sentry
  - generator
  - crud
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Source: feedback-09#F1, re-confirmed feedback-10 (NOT fixed), class definitely_bug.
Главный гейтер CRUD-coverage (5% → 43%, но дальше упирается).

Repro:
```
zond generate --api sentry --output /tmp/g --tag Dashboards
grep -A12 "Create a New Dashboard" /tmp/g/crud-dashboards.yaml
# json:
#   title: "{{$randomString}}"
#   id: "{{$uuid}}"             ← клиент НЕ должен слать id при create (readOnly)
#   widgets:
#     - id: "{{$uuid}}"
#       thresholds:               ← пустой ключ (yaml: thresholds null)
#       key1: "{{$randomString}}" ← мусор от additionalProperties:string
#       key2: "{{$randomString}}"
```
Параллельно ручной POST с минимальным `{title, widgets:[]}` → 201 Created.

Expected (a) для create-request не эмитить поля с `readOnly: true` в response schema;
(b) использовать `examples`/`example` из spec'а если есть;
(c) для рекурсивных схем (widgets[].thresholds) либо корректно сериализовать вложенный object, либо опускать optional;
(d) НЕ материализовать `additionalProperties: {type: string}` в `key1/key2` — это шаблон, а не реальные имена полей.

Actual: 26 из 30 CRUD-create-тестов фейлятся 400/403/404 на поломанном body. Только SCIM-Groups/Users работают (минимальный body), и то ограничены plan-gating'ом.

Импакт: каждый POST в сгенерированной chain — гарантированный fail; зависимые DELETE/PUT/GET-by-id → skip. Без F1 coverage упрётся в потолок ~10-43%, INCONCLUSIVE-BASE в security probes тоже не двигается (см. TASK-251).

Log: /tmp/zond-fb/sentry/rounds/raw-09.log, raw-10.log
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria

<!-- SECTION:ACCEPTANCE:BEGIN -->
- [x] readOnly-fields (`readOnly: true`) из request schema не попадают в request body.
- [x] Эвристика: literal-name `id` тоже не эмитится в request body (под-специфичные API типа Sentry не маркируют readOnly, но всё равно 4xx на client-supplied id).
- [x] `additionalProperties: {type: ...}` без явного списка ключей НЕ материализуется в `key1/key2/...` — теперь `{}` (record-shape сохранён, junk не идёт).
- [x] `example`/`examples` из spec'а используются как первый источник fixture-значений (уже было до фикса, оставлено).
- [x] Рекурсивные/nested object'ы: depth limit 5 → 8, на глубине-cap'е возвращается type-aware default (string→placeholder, array→[], etc), не bare `{}`. `[{}]` для `array<string>` больше не появляется.
- [x] Verify на sentry: `crud-dashboards.yaml` body чист — нет `id`, нет `key1/key2`, `fields: ["{{$randomString}}"]`.
- [x] Verify на sentry: `crud-alert-rules.yaml`, `crud-rules.yaml`, `crud-actions.yaml` — `grep -c 'id: "{{\\$uuid}}"'` = 0.
- [x] Tests: `tests/generator/data-factory.test.ts` обновлён под новую семантику (forRequest:false для тестов, проверяющих response-shape с `id`).

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
- `data-factory.ts`: signature `generateFromSchema(schema, propertyName, opts: {_depth, forRequest})`. Default `forRequest: true`.
- `shouldSkipForRequest(name, schema)` — единая точка фильтра (`readOnly === true || name === "id"`). Применяется в object-properties branch и в `generateMultipartFromSchema`.
- `additionalProperties` (object | true) → `{}` (вместо `{key1, key2}`).
- depth-limit: 5 → 8, новый `depthLimitDefault(schema, name)` возвращает type-aware значение.
- Все остальные call-sites (probes, mass-assignment, negative) автоматически получили filtering — они и так делают request-body.
- 1 pre-existing fail (`safe-run`, `manifest`) не связан, существовал до изменений.
<!-- SECTION:NOTES:END -->
<!-- SECTION:ACCEPTANCE:END -->
