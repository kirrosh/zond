---
id: TASK-42
title: 'T42: Generated expect.status — взять из spec, не дефолтить в 200'
status: To Do
assignee: []
created_date: '2026-04-27 15:28'
labels:
  - generator
milestone: m-1
dependencies: []
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Контекст

Генератор иногда ставит `expect.status: 200` для эндпоинта, который реально возвращает 201 (audiences POST в Resend). `getExpectedStatus` в `suite-generator.ts` уже ищет первый 2xx-ответ в спеке, но fallback на 200 срабатывает чаще, чем нужно — возможно, спека Resend не объявляет responses у некоторых операций, или responses-парсер их теряет.

## Что сделать

1. Воспроизвести: где именно дефолт 200 проявляется на Resend OpenAPI?
2. Проверить, что `getExpectedStatus` корректно достаёт первый 2xx.
3. Если нет 2xx response в spec — использовать осмысленный default по методу: POST→201, DELETE→204, остальное→200.

## Acceptance

- audiences POST генерируется с `expect.status: 201` (или диапазоном `[200, 201]`).
- DELETE без 2xx-response → 204 default.
<!-- SECTION:DESCRIPTION:END -->
