---
id: TASK-263
title: 'generator: учитывать format: (email/uri/uuid) и example:/examples: из spec при генерации body'
status: To Do
assignee: []
created_date: '2026-05-08 15:00'
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
- [ ] `format: email|uri|url|uuid|date-time` → соответствующий generator (или существующий `$random*` helper).
- [ ] `example:` (single) или `examples:` (list) — приоритет выше, чем `$random*` для того же поля; используется первый valid example.
- [ ] Если в schema есть и `format` и `example` — example выигрывает (предсказуемее).
- [ ] Tests: `data-factory.test.ts` покрывает email/uri/uuid/date-time + example-precedence.
- [ ] Verify: на Sentry POST `/integrations/`, `/users/me/notifications/`, `/projects/{...}/keys/` (где есть email/uri/example) → 201 без 400 на формате.
- [ ] `generate --explain` упоминает источник значения для field (`pattern`/`enum`/`format`/`example`/`random`).
<!-- SECTION:ACCEPTANCE:END -->
