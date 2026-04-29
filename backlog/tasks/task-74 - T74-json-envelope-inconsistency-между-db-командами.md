---
id: TASK-74
title: 'T74: --json envelope inconsistency между db-командами'
status: Done
assignee: []
created_date: '2026-04-29 08:40'
updated_date: '2026-04-29 14:30'
labels:
  - bug
  - cli
  - db
milestone: m-3
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Контекст

`zond db diagnose 5 --json` → {ok, command, data, warnings, errors} (envelope)
`zond db run 5 --json` → {run, results} (без envelope)

Программа парсящая одно ломается на другом. Парсер должен знать команду — нет единой обёртки.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Все db-команды с --json возвращают одинаковую обёртку: {ok, command, data, warnings, errors}
- [ ] #2 db run --json следует тому же envelope (сейчас отдаёт {run, results})
- [ ] #3 Документация envelope'а в ZOND.md
<!-- AC:END -->
