---
id: TASK-190
title: 'refactor: distribute commander registration into command modules'
status: Done
assignee: []
created_date: '2026-05-07 08:00'
updated_date: '2026-05-07 10:30'
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
- [x] #1 src/cli/program.ts ≤ 250 строк — **122 строки** (1103 → 122)
- [x] #2 каждая команда экспортирует register(program) рядом с action
- [x] #3 порядок help-output не меняется
- [x] #4 deprecated-алиасы probe-* сохранены (probe-validation/methods/mass-assignment/security)
- [x] #5 bun run check + bun test зелёные (1049 пасс)
- [x] #6 stdout всех 29 команд (zond --help + zond &lt;cmd&gt; --help) — byte-identical

## Round 1 (этот коммит)

Извлечён `src/cli/argv.ts` — argv-препроцессор (MSYS path), arg-парсеры (parsePositiveInt, parseRateLimit, parseInteger, parsePercentage, parseReporter), хелперы (collect, flatSplit). Ничего пользовательского не меняется. Это была самая чистая часть program.ts, никак не связанная с регистрацией команд.

## Round 2+ (выполнено)

- **Round 2a**: вытащил cli/resolve.ts (resolveSpecArg / resolveApiCollection / globalJson / warnDeprecatedProbe).
- **Round 2b**: clean / validate / use / refresh-api / doctor / update / completions.
- **Round 2c**: serve / session / coverage / describe / db / request.
- **Round 2d**: ci / init / add / generate / discover.
- **Round 2e**: probe (umbrella + 4 subs + 4 deprecated aliases) / lint-spec / catalog / export / report / run.
- **Финальная чистка**: removed dead imports (Option, parseReporter, ReporterName, jsonError, getDb, etc.).

Снимки `zond --help` и `zond <cmd> --help` (29 команд) сохранены в /tmp/zond-help/, проверка после каждого раунда.
<!-- AC:END -->
