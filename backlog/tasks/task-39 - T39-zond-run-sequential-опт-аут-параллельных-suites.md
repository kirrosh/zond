---
id: TASK-39
title: 'T39: zond run --sequential (опт-аут параллельных suites)'
status: To Do
assignee: []
created_date: '2026-04-27 15:28'
labels:
  - runner
  - ux
milestone: m-3
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Контекст

После T25 rate-limit работает корректно (подтверждено инструментально), но при N=cap API можно ловить boundary-429. Workaround — ставить `--rate-limit (cap-1)`. Но иногда хочется явный escape: «крути suites один за другим вне зависимости от пэйса».

## Что сделать

Флаг `--sequential` для `zond run`: вместо `Promise.all(...)` — последовательный `for await` по regular suites. Setup-suites уже последовательны.

Поведение: `--sequential` + `--rate-limit` совместимы (оба ограничивают). `--bail` уже sequential.

## Acceptance

- `zond run apis/x/tests --sequential` запускает suites один за другим.
- Не сломан существующий параллельный по умолчанию.
- Документировано в `--help` и ZOND.md.
<!-- SECTION:DESCRIPTION:END -->
