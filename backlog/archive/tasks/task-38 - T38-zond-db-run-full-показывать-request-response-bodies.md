---
id: TASK-38
title: 'T38: zond db run --full (показывать request/response bodies)'
status: To Do
assignee: []
created_date: '2026-04-27 15:28'
labels:
  - db
  - ux
milestone: m-3
dependencies: []
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Контекст

`zond db diagnose <run>` показывает request/response body. `zond db run <id>` — нет. Чтобы посмотреть тело конкретного запроса, надо либо запускать diagnose (медленно, агрегирует), либо ходить SQL'ем.

## Что сделать

Добавить `--full` флаг в `zond db run <id>`: при его наличии печатать request_body / response_body для каждого шага (или для filtered).

## Acceptance

- `zond db run 42 --full` показывает bodies.
- Без флага — текущее поведение (compact).
<!-- SECTION:DESCRIPTION:END -->
