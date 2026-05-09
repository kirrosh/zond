---
id: TASK-269
title: >-
  generator: --explain показывает источник значения для каждого field
  (pattern/enum/format/example/heuristic/random)
status: Done
assignee: []
created_date: '2026-05-08 15:30'
updated_date: '2026-05-09 09:36'
labels:
  - feedback-loop
  - generator
  - cli-ux
milestone: m-14
dependencies:
  - TASK-263
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Вынесено из TASK-263 — discoverability-бонус оттуда требует отдельной работы.

Сейчас `zond generate --explain` показывает CRUD-таблицу по endpoints (TASK-139). Field-level источник значений (для тела запроса) не виден: при дебаге "почему API вернул 400 на этом поле" агенту/пользователю нужно угадывать, что повлияло на сгенерированное значение — был ли там `example`, `enum`, `pattern`, `format` или просто `{{$randomString}}`.

Идея: дополнить `--explain` (или ввести `--explain-fields`) per-field источник значения, например:
```
POST /projects/
  body:
    name (string)        ← {{$randomName}}     [heuristic:name]
    slug (string)        ← {{$randomSlug}}     [pattern]
    platform (string)    ← "python"            [enum] (3 values: python, javascript, ruby)
    contact_email        ← {{$randomEmail}}    [format:email]
    region (string)      ← "us-east-1"         [example]
```

Это требует рефакторинга `generateFromSchema` — функция должна уметь возвращать не только значение, но и метаданные о том, какая ветка сработала. Простейшая форма: дополнительный `recordSource?: (path, source) => void` callback или возврат `{ value, source }`.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
<!-- SECTION:ACCEPTANCE:BEGIN -->
- [ ] #1 `generateFromSchema` (или обёртка) возвращает per-field source: `pattern` | `enum` | `format` | `example` | `examples` | `heuristic:<rule>` | `random` | `min/max`.
- [ ] #2 `zond generate --explain --tag <T>` (или новый флаг) печатает таблицу полей body с источником.
- [ ] #3 Tests: source-tracking покрыт юнит-тестами (минимум по 1 примеру на каждый источник).
- [ ] #4 Не ломает существующий API `generateFromSchema` (источник опционален).
<!-- SECTION:ACCEPTANCE:END -->
<!-- AC:END -->
