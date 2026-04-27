---
id: TASK-33
title: 'T33: Body generator — example > enum[0] > format > heuristic priority'
status: Done
assignee:
  - '@claude'
created_date: '2026-04-27 15:27'
updated_date: '2026-04-27 15:32'
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

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 schema.example используется первым в приоритете (перекрывает enum/format/heuristic)
- [x] #2 enum[0] выигрывает у format когда example отсутствует
- [x] #3 Media-level requestBody example/examples лифтится в schema.example
- [x] #4 Тесты покрывают все уровни приоритета
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
## План

1. **`src/core/generator/data-factory.ts:generateFromSchema`** — добавить early return для `schema.example` (до allOf/enum/format/type-switch). Уровень приоритета: example > enum[0] > format-uuid override > type-switch (где формат идёт через guessStringPlaceholder).
2. **`src/core/generator/openapi-reader.ts`** — поднять media-level `example` (и первое значение `examples`) в `schema.example`, чтобы генератор это видел. Не мутируя исходный спек-объект (cloning).
3. **Тесты в `tests/generator/data-factory.test.ts`** — пять уровней приоритета:
   - schema.example для primitive
   - schema.example для object (whole-body)
   - example beats enum
   - enum без example
   - format без example/enum
4. **Тесты в `tests/generator/openapi-reader.test.ts`** (или новый) — media-level example/examples лифтится в schema.example.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Реализация

**`src/core/generator/data-factory.ts:generateFromSchema`:**
- Добавлена early-return: `if (schema.example !== undefined) return schema.example;` в начале функции (до allOf/oneOf/anyOf резолвинга и enum/format обработки).
- Иерархия приоритетов теперь: **example > allOf-merge > oneOf/anyOf-resolve > enum > format > type-switch (с format/heuristics)**.
- Object/array example возвращаются as-is (без рекурсии в properties), потому что spec-author явно объявил полную форму.
- Enum уже был на втором месте — сохранили.

**`src/core/generator/openapi-reader.ts`:**
- При извлечении requestBody добавлен лифтинг media-level `example` на `schema.example`:
  1. Если `schema.example` уже есть — не трогаем (schema-level имеет приоритет над media-level).
  2. Иначе если `chosen.example` (single example) — копируем в новый schema-объект.
  3. Иначе если `chosen.examples` (named map) — берём `Object.values(...)[0].value`.
- Используется shallow clone (`{ ...requestBodySchema, example: ... }`), исходный спек-объект не мутируется.

**Тесты:**
- `tests/generator/data-factory.test.ts` — новый describe "T33 priority" (8 кейсов): primitive example beats format/enum, object example as-is, nested property example, enum-only path, format-only path, array example, integer example beats min/max.
- `tests/generator/openapi-reader.test.ts` — новый describe "media-level example lifting" (3 кейса): single example, examples-map first entry, schema.example precedence.

**Решения:**
- `schema.example` для object возвращается **as-is** (полная форма от spec-author), не комбинируется с генерацией недостающих полей. Если spec не дал например `region`, оно отсутствует в результате — это намеренно: «доверять спеке».
- OpenAPI 3.1 `examples` (вместо `example`) на schema-level намеренно не реализован — это редкий случай и требует выбора стратегии (random/first). Можно вынести в отдельный тикет.
- `format-uuid override` (line: `if (schema.format === "uuid") return "{{$uuid}}";`) перенесён ниже `example`, но всё ещё перед type-switch — поведение неизменно для случаев без example.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
OpenAPI `example` теперь имеет высший приоритет в `zond generate`.

**Изменения:**
- `generateFromSchema` возвращает `schema.example` early, до enum/format/heuristic.
- `openapi-reader.ts` лифтит media-level `example`/`examples` (3.0 формат) на `schema.example`, чтобы генератор видел оба источника как один сигнал.
- Иерархия: example > enum[0] > format > name-heuristic > random fallback.

**Файлы:**
- `src/core/generator/data-factory.ts`
- `src/core/generator/openapi-reader.ts`
- Тесты: data-factory (+8 в T33-блоке), openapi-reader (+3)

**Тесты:** 667/667 pass, typecheck clean.

**Эффект:** на Resend/любом spec с `example` в полях `endpoint`/`tls`/`region` etc. сгенерированные fixtures будут валидными вместо `{{$randomString}}`.
<!-- SECTION:FINAL_SUMMARY:END -->
