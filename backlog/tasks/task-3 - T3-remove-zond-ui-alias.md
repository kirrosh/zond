---
id: TASK-3
title: 'T3: Удалить алиас `zond ui`'
status: Done
assignee: []
created_date: '2026-04-27'
labels:
  - T3
  - phase-0
  - size-S
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
**Зачем.** Дублирующее имя для `serve --open`. Когнитивный шум.

**Что.** В `src/cli/index.ts` убрать ветку `case "ui"`. В `printUsage` убрать
строку `zond ui`. README/ZOND.md обновить.

**Файлы.** `src/cli/index.ts`, `ZOND.md`, `docs/quickstart.md`.

**Размер.** S.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 `zond ui` падает с unknown command
- [x] #2 `zond serve --open` работает как раньше
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Реализовано вместе с T1 в коммите `100fbb6`.

- Отдельного коммита не потребовалось: `ui` просто не зарегистрирован в новом
  `src/cli/program.ts`, поэтому commander сразу отдаёт
  `error: unknown command 'ui'` с дружелюбной подсказкой `(Did you mean ci?)`.
- Покрытие в `tests/cli/program.test.ts` (`'ui' is treated as unknown command`)
  и `tests/cli/cli-smoke.test.ts` (real-process spawn).
<!-- SECTION:NOTES:END -->
