---
id: TASK-15
title: 'T15: `.zond-current` — текущий API в workspace'
status: Done
assignee:
  - '@claude'
created_date: '2026-04-27'
updated_date: '2026-04-27 12:08'
labels:
  - T15
  - phase-3
  - size-S
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
**Зачем.** При повторении `--api <name>` в каждой команде агент тратит
впустую. Backlog.md аналогично трактует «текущую задачу» как контекст.

**Что.** Создать `src/core/context/current.ts`. Файл `.zond-current` в `cwd`
содержит имя/id коллекции. Команды (`run`, `coverage`, `request`) при
отсутствии `--api` читают этот файл. `zond use <api>` — установить.
`zond use --clear` — удалить.

**Файлы.** `src/core/context/current.ts`, `src/cli/commands/use.ts`,
обновления в `run.ts`, `coverage.ts`, `request.ts`.

**Размер.** S.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 `zond use petstore && zond run` работает без `--api petstore`
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Реализация
- `src/core/context/current.ts` — read/write/clear `.zond-current` (plain text, одна строка с именем коллекции; пустые строки нормализуются до null)
- `src/cli/commands/use.ts` — `zond use <api>` (set), `zond use --clear` (delete), `zond use` (show). С `--json` envelope.
- Регистрация в `src/cli/program.ts` (между `mcp` и `install`).
- Fallback в трёх action-handlers:
  - `run`: если `path` пустой и `--api` не задан → `readCurrentApi()`
  - `coverage`: если ни `--spec`, ни `--tests` не заданы и `--api` пустой → `readCurrentApi()`
  - `request`: если `--api` не задан → `readCurrentApi()`
  - Явные флаги/позиционные аргументы всегда выигрывают.

Тесты
- `tests/core/context-current.test.ts` — 5 unit на read/write/clear
- `tests/cli/use.test.ts` — 5 на CLI (set/clear/show/json/empty)
- `tests/cli/program.test.ts` — 2 e2e: `zond run` (без аргументов) с .zond-current="definitely-not-a-real-api" доходит до lookup'а коллекции (stderr содержит имя); явный path обходит fallback.

Зарегистрированы в `package.json` test:unit (новый `tests/cli/use.test.ts`).

Verification: tsc clean; 606 pass / 1 skip / 0 fail (+11 новых).
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
## Что сделано
`.zond-current` workspace context: при наличии файла команды `run`/`coverage`/`request` подхватывают API без `--api`. Управляется командой `zond use`.

**API:**
- `zond use <api>` — записать имя коллекции в `.zond-current`
- `zond use --clear` — удалить
- `zond use` (без аргументов) — показать текущее значение
- Все варианты поддерживают `--json` envelope

**Fallback chain:**
- `zond run` — если нет `path` и нет `--api`, читает `.zond-current`
- `zond coverage` — если нет `--spec`/`--tests` и нет `--api`, читает `.zond-current`
- `zond request` — если нет `--api`, читает `.zond-current`
- Явные флаги/позиционные аргументы всегда выигрывают

## Файлы
Создано: `src/core/context/current.ts`, `src/cli/commands/use.ts`, `tests/core/context-current.test.ts`, `tests/cli/use.test.ts`
Изменено: `src/cli/program.ts` (регистрация + fallback в 3 action'ах), `package.json` (test:unit), `tests/cli/program.test.ts` (e2e fallback тесты)

## Verification
- tsc clean
- 606 pass / 1 skip / 0 fail (+11 новых тестов)
- AC#1 покрыт: e2e тест подтверждает `zond run` без `--api` подхватывает имя из `.zond-current`
<!-- SECTION:FINAL_SUMMARY:END -->
