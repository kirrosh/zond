---
id: TASK-49
title: 'T49: Negative-input probe suite (UUIDs, empty body, длина, unicode)'
status: To Do
assignee: []
created_date: '2026-04-27 16:42'
labels:
  - bug-hunting
  - generator
milestone: m-4
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Контекст

Bug #05 (webhooks 500 на invalid event name) — частный случай большого класса: endpoint валится в 500 вместо 4xx когда получает невалидный input. Контракт: на любой невалидный ввод API должен вернуть 4xx, не 5xx.

## Что сделать

Новая команда `zond probe-validation <spec>` (или `zond generate --negative-inputs`):

Для каждого POST/PUT/PATCH endpoint генерирует probe-сьюты с **систематически невалидными** телами:

1. **Empty body:** `{}` → expect [400, 422].
2. **Missing required field:** удалить по очереди каждое required → 4xx.
3. **Invalid UUID:** на UUID-полях подставить `"not-a-uuid"`, `"00000000"`, `"12345"` → 4xx.
4. **Invalid format:** на email-полях `"not@email"`, на uri `"javascript:..."`, на date-time `"yesterday"` → 4xx.
5. **Boundary string:** на строковых required — `""`, длинная строка (10000 char), unicode-mix, RTL, emoji.
6. **Type confusion:** `name: 123` где string ожидается, `count: "five"` где integer.
7. **Boundary number:** integer min/max, отрицательные значения, NaN-like, 1.5 на integer.

Все результаты с `5xx` идут в `bugs/`, с `4xx` или `2xx` — в обычный pass.

В ZOND.md добавить таблицу probe-классов и какие баги они ловят.

## Acceptance

- На Resend webhooks API ловит #05 (500 на invalid event name).
- Не путает legitimate 4xx (валидация работает) с 5xx (валидация сломана).
- Результаты shrinkable до минимального теста.

## Связь с T45

Subset функциональности T45 (fuzzer), но **детерминированный** — каждый probe всегда одинаковый, можно закоммитить как regression-test. T45 рандомный + shrink.
<!-- SECTION:DESCRIPTION:END -->
