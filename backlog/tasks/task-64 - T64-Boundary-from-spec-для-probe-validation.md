---
id: TASK-64
title: 'T64: Boundary-from-spec для probe-validation'
status: To Do
assignee: []
created_date: '2026-04-29 08:35'
labels:
  - bug-hunting
  - generator
milestone: m-4
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Контекст

TASK-49 (Done) шлёт generic boundary: пустую строку, 10000-char, unicode. Но не использует реальные ограничения из OpenAPI: maxLength, minLength, maximum, minimum, exclusiveMaximum, exclusiveMinimum, multipleOf, pattern. Off-by-one'ы вылезают именно на N+1, а не на 10000.

## Что сделать

Расширить генератор probe-validation: для каждого constraint из spec эмитить probe со значениями:
- string maxLength=N: value длины N (boundary), N+1 (over), 0 (under если minLength=N)
- integer maximum=N: N, N+1, N-1
- integer minimum=N: N, N-1
- pattern: невалидное значение НЕ удовлетворяющее regex (нужна простая mutation)
- multipleOf=N: N+1 (не кратно)

Probe deterministic — same spec → same probes. Тег `[boundary, from-spec]` для отделения от generic boundary-проб.

## Acceptance

- На spec с maxLength=255 эмитит probe value длины 256.
- На integer minimum=1 эмитит probe value=0.
- Покрытие констрейнтов: maxLength, minLength, maximum, minimum, exclusiveMaximum, exclusiveMinimum.
- Документация.

## Связь

Follow-up для TASK-49 (probe-validation, Done).
<!-- SECTION:DESCRIPTION:END -->
