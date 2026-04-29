---
id: TASK-71
title: 'T71: YAML parse errors без указания row:col'
status: To Do
assignee: []
created_date: '2026-04-29 08:38'
labels:
  - bug
  - parser
  - ux
milestone: m-3
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Контекст

Top-5 ROI fix. Ошибки парсера YAML выдаются без локации:
```
Error: Invalid YAML in apis/resend/tests/probe-crlf-injection.yaml: YAML Parse error: Unexpected character
```

Никакого row:col. Пришлось руками прогонять через js-yaml, чтобы найти что в одном файле колон в названии теста (`(note: OpenAPI...)`), в другом — NUL-байт.

## Что сделать

bun имеет встроенный YAML; либо использовать его error-format, либо протащить ошибку js-yaml целиком (она содержит mark с line/col). Минимум — формат `file:line:col: <reason>` плюс снаружи строки с pointer на колонку.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Сообщение содержит file:line:col
- [ ] #2 Поведение на колоне внутри test-name (note: ...): понятный pointer на строку
- [ ] #3 NUL-байт в YAML: показать file:line + suggest $nullByte generator
<!-- AC:END -->
