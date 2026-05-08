---
id: TASK-277
title: 'validate-schema reporter: [object Object] вместо имени required-поля'
status: To Do
assignee: []
created_date: '2026-05-08 19:00'
labels:
  - feedback-loop
  - api-sentry
  - validate-schema
  - reporter
  - ux
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Source: feedback-14#F2, class ux-papercut, distinct from TASK-249 (TASK-249 — про `zond validate` YAML, здесь — про `--validate-schema` response-vs-OpenAPI).

При `zond run --validate-schema --spec ...` reporter печатает:
```
body: expected schema.required but got [object Object]
body.plugins.0: expected schema.required but got [object Object]
```

`[object Object]` — JS-объект, попавший в строку через шаблонную интерполяцию (`${expected}` вместо `JSON.stringify(expected)` или selective-extract). Имя пропущенного required-поля недоступно глазами; чтобы понять drift, надо лезть в spec и сравнивать руками.

Expected:
```
body: missing required field [name]; expected required: [id, slug, name]
body.plugins.0: missing required field [version]; expected required: [name, version]
```

Impact: 6 schema-drift'ов в feedback-14 пришлось дешифровать руками; первый actionable insight теряется на reporter-уровне.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria

<!-- SECTION:ACCEPTANCE:BEGIN -->
- [ ] В reporter'е `--validate-schema` сериализовать ожидаемые/полученные required-наборы как `[id, slug, name]` (не `[object Object]`).
- [ ] Если diff между expected/actual required можно вычислить — выводить `missing: [name]` отдельной строкой.
- [ ] Regression-тест на схему с required + actual без поля → вывод содержит имя пропущенного поля, не `[object Object]`.
- [ ] Аналогично для других schema-узлов, где сейчас возможна `[object Object]` интерполяция (grep по reporter'у на `${.*expected}` / `${.*actual}` без stringify).
<!-- SECTION:ACCEPTANCE:END -->
