---
id: TASK-14
title: 'T14: Интерактивный `zond init` через `@clack/prompts`'
status: To Do
assignee: []
created_date: '2026-04-27'
labels:
  - T14
  - phase-3
  - size-S
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
**Зачем.** Сейчас `init` — флаг-only. Для первого запуска (без AI-агента) это
неприветливо. clack даёт красивые prompt'ы.

**Что.**
1. `@clack/prompts` в dependencies.
2. Если флаги не переданы — запустить wizard:
   - text: «Имя API?» (default — title из спеки),
   - text: «Путь к OpenAPI-spec?»,
   - text: «base URL?» (default — из spec.servers[0]),
   - confirm: «Установить MCP в Claude Code?» (вызов `zond install --claude`).

Если флаги переданы — текущее поведение, без prompts.

**Файлы.** `src/cli/commands/init.ts`, `package.json`.

**Размер.** S.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 `zond init` без аргументов открывает wizard
- [ ] #2 `zond init --spec X --name Y` — без prompts (текущее поведение)
<!-- AC:END -->
