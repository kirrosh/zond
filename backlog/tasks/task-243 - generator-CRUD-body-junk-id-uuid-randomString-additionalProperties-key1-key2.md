---
id: TASK-243
title: 'generator: CRUD body содержит junk (id: {{$uuid}}, key1/key2 от additionalProperties, hanging null) — POST везде fail'
status: To Do
assignee: []
created_date: '2026-05-08 13:00'
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
- [ ] readOnly-fields из response schema не попадают в request body create-эндпоинта.
- [ ] `additionalProperties: {type: ...}` без явного списка ключей НЕ материализуется в `key1/key2/...`.
- [ ] `example`/`examples` из spec'а используются как первый источник fixture-значений (приоритет выше, чем `{{$randomString}}`).
- [ ] Рекурсивные/nested object'ы сериализуются полностью, без hanging-keys (`thresholds:` без значения → либо `{}`, либо опускается).
- [ ] Verify на sentry: `crud-dashboards.yaml` POST → 2xx (с правильным token/scope) при пустом `widgets`.
- [ ] Regression-fixture: minimal-spec → minimal-body, без `id`/`key1`/`key2`.
<!-- SECTION:ACCEPTANCE:END -->
