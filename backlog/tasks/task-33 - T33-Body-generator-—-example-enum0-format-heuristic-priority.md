---
id: TASK-33
title: 'T33: Body generator — example > enum[0] > format > heuristic priority'
status: To Do
assignee: []
created_date: '2026-04-27 15:27'
labels:
  - generator
  - robustness
milestone: m-1
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Контекст

После T26 генератор использует `format` и name-heuristics, но игнорирует **`example`** и **`enum`** в OpenAPI-схемах. Из-за этого 6 из 11 сгенерированных Resend CRUD-сьютов валятся с 422 на первом прогоне:

- `endpoint: "{{$randomString}}"` для webhook URL вместо реального `https://...` (есть `example` в spec).
- `tls: "{{$randomString}}"` для enum-поля `["enforced", "opportunistic"]` — невалидное значение.
- `audience_id: "{{$uuid}}"` для FK на несуществующий ресурс — нужен capture или сетап.

## Что сделать

Строгий приоритет в `src/core/generator/data-factory.ts:generateFromSchema` и `guessStringPlaceholder`:

1. **`schema.example`** — если есть, использовать as-is (через JSON-инъекцию для object/array, через String для primitives).
2. **`schema.enum[0]`** — для перечислений всегда первое значение.
3. **`schema.format`** — текущая T26-логика.
4. **Name-based heuristics** — текущие.
5. **Fallback** — `{{$randomString}}` / `{{$randomInt}}`.

Применять и для request body, и для query/path-параметров (`getRequiredQueryParams`, `convertPathWithSeeds`).

## Acceptance

- Поля с `example` в OpenAPI используют это значение.
- Enum-поля получают первое валидное значение.
- Тесты покрывают все 5 уровней приоритета (object example, primitive example, enum, format, fallback).
- Регрессионный замер: на Resend OpenAPI количество 422 на первом прогоне сгенерированных CRUD сьютов уменьшается с ~6/11 до ≤2/11.

## Связь с T26

Дополняет T26: format остаётся, но example/enum получают приоритет.
<!-- SECTION:DESCRIPTION:END -->
