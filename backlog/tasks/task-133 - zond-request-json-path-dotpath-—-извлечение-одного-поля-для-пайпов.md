---
id: TASK-133
title: zond request --json-path <dotpath> — извлечение одного поля для пайпов
status: To Do
assignee: []
created_date: '2026-05-05 10:04'
labels: []
dependencies: []
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Вывод `zond request --json` — это `{ok, data: {status, headers, body, duration_ms}}`. При пайпинге в bun/python на разборе JSON ловятся EventEmitter-шумы, jq не всегда под рукой.

Надо: добавить `--json-path <dotpath>` (напр. `data.body.id` или `data.status`), который печатает в stdout именно одно значение (string без кавычек для скаляров, JSON для объектов/массивов). Облегчает скриптинг и shell-cookbook.

Источник: фидбэк по JSONPlaceholder (затык №6).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 zond request --json-path data.status печатает 200 без оборачивания
- [ ] #2 --json-path для object/array печатает валидный JSON
- [ ] #3 несуществующий путь — exit code != 0 + понятный stderr
<!-- AC:END -->
