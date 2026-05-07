---
id: TASK-184
title: 'refactor: codify --json envelope policy in one module'
status: Done
assignee: []
created_date: '2026-05-07 06:49'
updated_date: '2026-05-07 07:14'
labels:
  - refactor
  - cli
  - json
milestone: m-11
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
TASK-73, TASK-74 — про неконсистентный --json. Сейчас каждая команда сама решает, что выводить в envelope. Зафиксировать одну точку: src/cli/json-envelope.ts получает API typed-envelope { ok, data, error, meta }, команды отдают только payload. Снимает рандомные расхождения и упрощает добавление новых команд. Закрывает связку TASK-73/74 как побочку.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 src/cli/json-envelope.ts экспортирует withEnvelope() / writeEnvelope() с типами
- [ ] #2 Все команды с --json идут через эту точку (grep на --json: 0 ad-hoc формирований)
- [x] #3 tests/cli/json-envelope.test.ts покрывает success/error/meta форму
- [x] #4 TASK-73 + TASK-74 закрываются как fixed-by
<!-- AC:END -->
