---
id: TASK-1
title: 'T1: Заменить ручной parseArgs на commander'
status: Done
assignee: []
created_date: '2026-04-27'
labels:
  - T1
  - phase-0
  - size-S
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
**Зачем.** `src/cli/index.ts` ~600 строк, из них ~300 — кастомный парсер с
ре-парсингом argv для повторяемых флагов (`--tag`, `--header`, `--env-var`).
Класс багов, который не нужно поддерживать.

**Что.**
1. Добавить `commander@^14` в dependencies.
2. Переписать `src/cli/index.ts` через `Command` API. Каждая команда —
   собственный `program.command(...)`. `--tag`/`--header`/`--env-var` —
   через `.option('--tag <t>', ..., collect, [])`.
3. Сохранить MSYS-фикс как pre-processor над `process.argv` до передачи в
   commander (флаги `--path`, `--json-path`).
4. Help/version отдаются commander-ом.

**Файлы.** `src/cli/index.ts`, `package.json`.

**Размер.** S.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Все тесты `tests/cli/*.test.ts` зелёные без правок (значит, поведение сохранено)
- [x] #2 LOC файла `src/cli/index.ts` снижается с ~600 до ~250
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Реализовано в коммите `100fbb6`.

- `src/cli/index.ts`: 627 → **38 LOC** (лучше плана — оставлен только bootstrap).
- Новый `src/cli/program.ts` (570 LOC): `buildProgram()` + `preprocessArgv()`.
- Дополнительно создан `src/cli/version.ts` — чтобы разорвать циркулярку
  `index.ts ↔ commands/update.ts`.
- `db` оформлен как **вложенный** subcommand (`db collections`, `db runs`,
  `db run <id>`, `db diagnose <id>`, `db compare <a> <b>`) — `zond db --help`
  идиоматичен.
- Новый класс тестов: `tests/cli/program.test.ts` (unit через
  `buildProgram()`) + `tests/cli/cli-smoke.test.ts` (real-process spawn).
  Покрытие repeatable-флагов, MSYS-фикса, числовых валидаций — было нулевым,
  стало явным.
- `tests/cli/args.test.ts` удалён вместе с экспортом `parseArgs`.
<!-- SECTION:NOTES:END -->
