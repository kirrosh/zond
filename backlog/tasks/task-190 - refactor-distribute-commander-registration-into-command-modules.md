---
id: TASK-190
title: 'refactor: distribute commander registration into command modules'
status: To Do
assignee: []
created_date: '2026-05-07 08:00'
labels:
  - refactor
  - cli
milestone: m-11
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
src/cli/program.ts — 1103 строки: 207 `.command()/.option()` для 28 команд в одном файле. Вложенные `defineProbe*` уже намекают на нужный паттерн, но регистрация остаётся в program.ts.

Перенести регистрацию в `commands/<name>.ts` (каждая экспортирует `register(program: Command)`), program.ts — тонкий аггрегатор. Probe umbrella (TASK-182) сохраняется: `commands/probe/index.ts` регистрирует подкоманды.

Цель: program.ts ≤ 200 строк, каждая команда самодостаточна (action + commander schema рядом).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 src/cli/program.ts ≤ 250 строк
- [ ] #2 каждая команда экспортирует register(program) рядом с action
- [ ] #3 порядок help-output не меняется
- [ ] #4 deprecated-алиасы probe-* сохранены
- [ ] #5 bun run check + bun test зелёные
- [ ] #6 stdout всех smoke-команд (--help, doctor, probe --help) — без diff
<!-- AC:END -->
