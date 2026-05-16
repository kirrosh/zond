---
id: TASK-57
title: 'T57: Response-schema validation против OpenAPI'
status: Done
assignee: []
created_date: '2026-04-29 08:34'
updated_date: '2026-04-29 10:29'
labels:
  - bug-hunting
  - contract
milestone: m-4
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Контекст

Live-сессия (round 2) дала B11: GET /emails?limit=999999 не возвращает обязательное поле has_more. Это контракт-дрейф, который видно только при валидации ответа против OpenAPI-схемы. Сейчас zond проверяет только exists: true в YAML — типы, enum, format, required, additionalProperties не валидируются.

Это самая богатая жила контракт-багов: на любом нетривиальном API первый прогон даёт десятки находок (null где string, дополнительные поля не в спеке, дрифт enum'ов между кодом и доками).

Отличие от TASK-51 (cross-endpoint consistency): T51 сравнивает ответы между endpoints друг с другом; T57 валидирует каждый ответ против заявленной OpenAPI-схемы.

## Что сделать

1. Опция `--validate-schema` для `zond run`: для каждого ответа достаём OpenAPI-схему (по path + method + status), валидируем JSON через ajv (или эквивалент).
2. Найденные нарушения surface'ятся как failures с понятным diff'ом: путь поля, ожидаемый тип/format/enum, фактическое значение.
3. Проверяем: типы, required, enum, format (email/uri/uuid/date-time), additionalProperties, oneOf/anyOf.
4. Для 4xx ответов — валидация против error-schema если объявлена.
5. Документация в ZOND.md, секция в README.

## Acceptance

- На Resend OpenAPI ловит B11 (has_more отсутствует на limit=999999).
- ajv-style ошибки читаемы (path + reason).
- Включается флагом — не ломает существующие прогоны без флага.
- Поддержка $ref / nested schemas.
<!-- SECTION:DESCRIPTION:END -->
