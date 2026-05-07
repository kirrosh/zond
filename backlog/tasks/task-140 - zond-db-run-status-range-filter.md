---
id: TASK-140
title: 'zond db run --status: фильтр по диапазону / классу (5xx, >=500)'
status: Done
assignee: []
labels:
  - db
  - cli
  - triage
milestone: m-8
dependencies: []
priority: medium
---

## Description

## Контекст

Источник: [m-8 feedback §D раунд 2](../notes/m-8-audit-cli-gaps/feedback-original.md).

`zond db run <id> --status <code>` принимает только конкретный статус.
В триаже больших прогонов (Sentry, 2665 запросов) хочется
`--status 5xx` или `--status '>=500'`. Сейчас — либо 500/501/502/503
руками, либо jq на `--json`.

## Что сделать

Расширить парсер `--status` для `zond db run`:
- Конкретный код: `--status 502` (как сейчас).
- Класс: `--status 5xx` / `4xx` / `3xx` / `2xx`.
- Диапазон: `--status '>=500'`, `--status '<400'`, `--status 500-599`.
- Несколько значений через запятую: `--status 500,502,504` или
  `--status 5xx,429`.

Тот же синтаксис применить в `zond db runs` (фильтр по самому худшему
статусу прогона), если он там есть.

## Acceptance Criteria

- [x] Все четыре формы (`502`, `5xx`, `>=500`, `500-599`,
      `5xx,429`) парсятся.
- [x] Невалидный синтаксис — понятная ошибка.
- [x] Юнит-тесты на парсер.
- [x] `--help` обновлён с примерами.
- [x] CHANGELOG. `zond db runs` не имеет `--status`-флага — фильтра по
      "худшему статусу прогона" нет в текущем CLI, поэтому там менять
      нечего; синтаксис применён только к `zond db run`.
