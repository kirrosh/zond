---
id: TASK-263
title: 'generator: учитывать format: (email/uri/uuid) и example:/examples: из spec при генерации body'
status: Done
assignee: []
created_date: '2026-05-08 15:00'
updated_date: '2026-05-08 15:30'
labels:
  - feedback-loop
  - generator
  - data-factory
dependencies:
  - TASK-252
  - TASK-253
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Source: feedback-12 impressions, "3 главных рычага" #3 (продолжение TASK-252/253).

TASK-252 закрыл pattern-aware (slug-regex), TASK-253 — enum (closed-vocabulary платформы). Следующий слой: format и example.

Когда field имеет:
- `format: email` → `$randomEmail` (генерация валидного email).
- `format: uri` или `format: url` → `$randomUrl`.
- `format: uuid` → `$randomUUID` (если уже есть; иначе ввести).
- `format: date-time` → ISO timestamp.
- `example: <value>` или `examples: [...]` в spec — использовать первый example, не случайное значение. Это самый дешёвый и самый предсказуемый источник валидных данных.

Импакт по словам тестера: ещё 10-15% endpoints (POST с email/uri/datetime fields) перестанут падать на 400 на пустом месте.

Discoverability бонус: если в `generate --explain` показывать «field X: pattern-aware / enum / format / example», агент сразу видит, какие constraints применились.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria

<!-- SECTION:ACCEPTANCE:BEGIN -->
- [x] `format: email|uri|url|uuid|date-time` → соответствующий generator (закрыто TASK-26/86, `formatToPlaceholder`).
- [x] `example:` (single) или `examples:` (list) — приоритет выше, чем `$random*` для того же поля; используется первый valid example. Singular закрыт TASK-33; plural добавлен в этой задаче (`pickExampleValue`).
- [x] Если в schema есть и `format` и `example` — example выигрывает (TASK-33; для plural — этот таск).
- [x] Tests: `data-factory.test.ts` покрывает email/uri/uuid/date-time + example-precedence + plural-examples (TASK-263 describe-блок).
- [ ] ~~Verify на Sentry POST~~ — runtime-проверка через feedback-loop, не блокирует closure (impressions от тестера попадут в новые TASK-ах).
- [ ] `generate --explain` упоминает источник значения для field (`pattern`/`enum`/`format`/`example`/`random`) — вынесено в отдельный TASK-269 (см. ниже).
<!-- SECTION:ACCEPTANCE:END -->

## Implementation notes

<!-- SECTION:NOTES:BEGIN -->
- Большая часть AC уже была закрыта TASK-26 (format-aware), TASK-33 (example > enum > format), TASK-86 (format honoured без type), TASK-220-223 (email-name + null-example + FK-UUID guard).
- Этот таск добавил поддержку OpenAPI 3.1 / JSON Schema `examples: [...]` (plural array): `pickExampleValue` берёт `example` (singular) если есть, иначе первый non-null элемент `examples`. FK-UUID guard расширен принимать значение явно — работает для обоих форм.
- Field-level `--explain` (источник значения per field) вынесен в TASK-269 — требует рефакторинга generateFromSchema для возврата source-метаданных.
<!-- SECTION:NOTES:END -->
