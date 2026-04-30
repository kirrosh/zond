---
id: TASK-73
title: 'T73: --json (top-level) и --report json конфликтуют'
status: Done
assignee: []
created_date: '2026-04-29 08:38'
updated_date: '2026-04-29 14:26'
labels:
  - bug
  - cli
milestone: m-3
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Контекст

```
$ zond run apis/resend/tests --safe --json   ← падает (см. T68)
$ zond run apis/resend/tests --safe --report json  ← OK
```

Top-level --json существует и упоминается в --help, но при попытке использовать с run ломается. По-хорошему либо удалить (раз есть per-команда --report json), либо реально поддерживать.

Decision: предпочтительно удалить --json чтобы flag-namespace остался однозначным.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Решено: либо удалить --json и оставить только --report json, либо реально работать (без падения 'paths[0] not string')
- [ ] #2 В --help нет двусмысленности
<!-- AC:END -->
