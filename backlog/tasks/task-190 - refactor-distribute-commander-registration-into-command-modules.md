---
id: TASK-190
title: 'refactor: distribute commander registration into command modules'
status: In Progress
assignee: []
created_date: '2026-05-07 08:00'
updated_date: '2026-05-07 09:30'
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
- [ ] #1 src/cli/program.ts ≤ 250 строк (round 1: 1103 → 1013, осталось ~750)
- [ ] #2 каждая команда экспортирует register(program) рядом с action
- [x] #3 порядок help-output не меняется (round 1: diff пустой)
- [ ] #4 deprecated-алиасы probe-* сохранены
- [x] #5 bun run check + bun test зелёные (round 1: 1049 пасс)
- [x] #6 stdout всех smoke-команд (--help, doctor, probe --help) — без diff (round 1)

## Round 1 (этот коммит)

Извлечён `src/cli/argv.ts` — argv-препроцессор (MSYS path), arg-парсеры (parsePositiveInt, parseRateLimit, parseInteger, parsePercentage, parseReporter), хелперы (collect, flatSplit). Ничего пользовательского не меняется. Это была самая чистая часть program.ts, никак не связанная с регистрацией команд.

## Round 2+ (отложено)

Распределить .command()/.option()/.action() блоки по самим commands/<name>.ts (каждая экспортирует `register(program: Command)`). Объём — ~28 команд × 5–20 строк регистрации = ~750 строк миграции. Защита: diff `zond --help` и `zond <cmd> --help` для каждой команды.
<!-- AC:END -->
