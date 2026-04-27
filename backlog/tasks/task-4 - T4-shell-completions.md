---
id: TASK-4
title: 'T4: Shell-completions — `zond completions <bash|zsh|fish>`'
status: Done
assignee: []
created_date: '2026-04-27'
labels:
  - T4
  - phase-0
  - size-S
dependencies:
  - TASK-1
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
**Зачем.** DX. У Backlog.md есть, у zond — нет.

**Что.** После T1: commander умеет генерить completions. Завернуть в
`zond completions <shell>`, печатать в stdout. README — секция установки.

**Файлы.** `src/cli/commands/completions.ts` (новый), `src/cli/index.ts`,
`README.md`.

**Зависит от.** T1.

**Размер.** S.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 `zond completions zsh > _zond` даёт рабочий completion-скрипт
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Реализовано в коммите `5a3b3f1`.

- Commander v14 не имеет встроенной генерации completions — реализованы
  вручную, без сторонних `tabtab`/`omelette`. Включены **все три шелла**
  (bash, zsh, fish).
- `src/cli/commands/completions.ts` — чистый рендерер, принимает `program`
  как аргумент (избегает циркулярки `program ↔ completions`).
- Список команд/флагов извлекается через `extractSpec(program)` из живого
  commander-дерева — completions всегда в синхронизации с CLI.
- README получил секцию «Shell completions» с инструкциями установки.
- Тесты: `tests/cli/completions.test.ts` (4 unit + 5 spawn).
<!-- SECTION:NOTES:END -->
