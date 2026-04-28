---
id: TASK-HIGH.6
title: >-
  drop-mcp 3: cleanup zond init / zond install (remove --integration mcp default
  and install --claude/--cursor)
status: Done
assignee: []
created_date: '2026-04-28 10:36'
updated_date: '2026-04-28 11:36'
labels:
  - drop-mcp
  - cli
dependencies: []
parent_task_id: TASK-HIGH
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Привести `zond init` и `zond install` к CLI-only flow.

## Scope
- `src/cli/commands/install.ts` — удалить целиком (он только конфигурит ~/.claude/mcp.json и ~/.cursor/mcp.json для запуска `zond mcp start`). Убрать регистрацию команды `install` в `src/cli/program.ts`.
- `src/cli/commands/init.ts` — убрать опцию `--integration mcp`; единственный режим — `cli` (текущий fallback). Соответственно сделать `integration: "cli" | "skip"` или вообще убрать опцию (всегда cli).
- `src/cli/commands/init/agents-md.ts` — удалить импорт `agents-mcp-nudge.md` и его использование, оставить только `agents-cli-full.md`. Шаблон `agents-mcp-nudge.md` удалить.
- `src/cli/commands/init/bootstrap.ts` — поле `mcpInstalled` убрать из `BootstrapResult` и связанной логики печати в `init.ts`.
- Тесты в `tests/cli/init/` — выкинуть MCP-кейсы, оставить cli-only.

## Acceptance
- `zond init --help` не упоминает MCP.
- `zond install` либо отсутствует, либо переименована во что-то осмысленное (например, `zond agents-md write` если хочется sugar для записи AGENTS.md).
- `bun run check` чистый, `bun test` зелёный.

## Связь
Эпик: decision-2. После drop-mcp-1 (но можно параллельно). Парный с drop-mcp-2.
<!-- SECTION:DESCRIPTION:END -->
