---
id: TASK-247
title: 'report --json: поле .captures всегда пустое {} (schema есть, semantics нет)'
status: Done
assignee: []
created_date: '2026-05-08 13:00'
updated_date: '2026-05-08 13:55'
labels:
  - feedback-loop
  - api-sentry
  - reporter
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Source: feedback-07#F2 (half-fix in feedback-10), class definitely_bug.

После фикса в схему envelope добавлено поле `.captures` на каждом step-е. Но **значение всегда `{}`**, даже когда в YAML определён `capture: {x: body.0.slug}` и step прошёл с 200 (значение реально использовалось дальше в chain).

Repro:
```
zond run apis/sentry/tests/crud-...yaml --report json --report-out /tmp/x.json
jq '.[].steps[].captures' /tmp/x.json   # → все {}
jq '.[].steps[]|select(.captures != {})' /tmp/x.json   # → ничего
```

Expected: `captures` отражает фактически пойманные значения (или хотя бы ключи + redacted-маркер для CI-парсера).
Actual: schema есть, populate нет. CI не может проверить «capture сработал».
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria

<!-- SECTION:ACCEPTANCE:BEGIN -->
- [x] Реально пойманные значения попадают в `.captures: {key: value}` каждого step (verify: GET /uuid с `body: {uuid: {capture: my_uuid, type: string}}` → `.captures.my_uuid` = реальный UUID).
- [x] Detected root cause: пользователь использовал non-canonical syntax `expect.capture: {x: ...}` (top-level block внутри expect) — это всегда silently dropped'ось, captures оставались `{}`. Зафиксировано: parser теперь throw'ит actionable-ошибку с правильным синтаксисом.

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
- Семантика была корректной: `extractCaptures` в `assertions.ts` правильно walks `expect.body[path].capture`. JSON envelope тоже правильно сериализует — verify через httpbin.org/uuid дал `{"my_uuid": "<real-uuid>"}`.
- Реальный bug был в "half-fix"-репорте пользователя: yaml использовал `expect.capture: {x: body.0.slug}` (top-level capture), который parser dropping'овал. Теперь parser detects этот pattern и throw'ит:
  > 'expect.capture: {...}' is not a valid step shape. Captures are defined per-field: `expect.body: { "<path>": { capture: <var_name> } }`.
- Изменение в `src/core/parser/schema.ts:TestStepExpectSchema` preprocess.
<!-- SECTION:NOTES:END -->
<!-- SECTION:ACCEPTANCE:END -->
