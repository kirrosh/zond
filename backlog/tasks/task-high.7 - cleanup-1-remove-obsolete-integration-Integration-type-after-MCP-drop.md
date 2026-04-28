---
id: TASK-HIGH.7
title: 'cleanup 1: remove obsolete --integration / Integration type after MCP drop'
status: In Progress
assignee: []
created_date: '2026-04-28 12:02'
updated_date: '2026-04-28 12:37'
labels:
  - cleanup
  - refactor
  - post-drop-mcp
dependencies: []
parent_task_id: TASK-HIGH
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
После выпила MCP `AgentsIntegration = "cli"` (single-value union) и `Integration = "cli" | "skip"` стали избыточными типами. Параметр `_integration: AgentsIntegration` в `agents-md.ts` явно игнорируется (префикс _). Можно упростить.

## Scope
- `src/cli/commands/init/agents-md.ts`:
  - Убрать `AgentsIntegration` тип и параметр `_integration` из `blockBody()` и `upsertAgentsBlock()`.
  - Сигнатура: `upsertAgentsBlock(cwd: string)`.
- `src/cli/commands/init/bootstrap.ts`:
  - Решить судьбу `Integration = "cli" | "skip"`. Варианты:
    a) оставить как есть — "cli" пишет AGENTS.md, "skip" не пишет (две разные ветки логики).
    b) заменить на boolean флаг `writeAgents: boolean` (по умолчанию true).
  - Рекомендация: (b) — более идиоматично.
- `src/cli/commands/init.ts`:
  - Если выбрано (b), убрать `integration: Integration` из `InitOptions`, заменить на `noAgents?: boolean`.
  - В `printBootstrapResult` убрать форматирование `()`.
- `src/cli/program.ts`:
  - Опцию `--integration <mode>` заменить на `--no-agents-md` (или оставить как deprecated alias на 1 минор).
- Тесты:
  - `tests/cli/init/agents-md.test.ts`, `tests/cli/init/bootstrap.test.ts` — обновить под новую сигнатуру.
- Документация:
  - `ZOND.md` — таблица integration mode → удалить, заменить на одну строку про `--no-agents-md`.

## Acceptance
- `grep -E 'AgentsIntegration|Integration\b' src/` пусто (или только в исторических комментариях).
- `bun run check` чистый, `bun test` зелёный.
- В `zond init --help` либо нет `--integration`, либо есть deprecated note.

## Связь
Эпик: post-drop-mcp cleanup. Связано с decision-2.
<!-- SECTION:DESCRIPTION:END -->
