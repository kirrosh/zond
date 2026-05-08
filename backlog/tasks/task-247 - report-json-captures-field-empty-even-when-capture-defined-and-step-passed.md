---
id: TASK-247
title: 'report --json: поле .captures всегда пустое {} (schema есть, semantics нет)'
status: To Do
assignee: []
created_date: '2026-05-08 13:00'
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
- [ ] Реально пойманные значения попадают в `.captures: {key: value}` каждого step.
- [ ] Опция redact (например для secrets): `.captures: {key: "[redacted]"}` если поле помечено sensitive.
- [ ] Regression-test: yaml с capture → JSON envelope содержит captured-value.
<!-- SECTION:ACCEPTANCE:END -->
