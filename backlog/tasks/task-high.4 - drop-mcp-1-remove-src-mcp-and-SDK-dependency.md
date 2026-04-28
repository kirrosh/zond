---
id: TASK-HIGH.4
title: 'drop-mcp 1: remove src/mcp/ and SDK dependency'
status: Done
assignee: []
created_date: '2026-04-28 10:36'
updated_date: '2026-04-28 11:36'
labels:
  - drop-mcp
  - refactor
dependencies: []
parent_task_id: TASK-HIGH
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Удалить весь MCP-слой согласно decision-2.

## Scope
- rm -rf `src/mcp/` (server.ts, index.ts, tools/, resources/, content/, registry, types).
- Удалить `@modelcontextprotocol/sdk` из package.json + bun.lock.
- Удалить `src/cli/commands/mcp.ts` и регистрацию `zond mcp start` в `src/cli/program.ts`.
- Сохранить `.mcp.json` в корне (он про backlog-MCP, не zond) — но добавить туда комментарий про upstream-backlog-only.

## Acceptance
- `grep -r 'mcp\|MCP' src/` возвращает только `.mcp.json` references / упоминания в комментариях о выпиле.
- `bun run check` чистый, `bun test` зелёный.
- Размер бинарника `bun build` уменьшился (зафиксировать факт в коммите).

## Связь
Эпик: decision-2. Парный с drop-mcp-2/3/4.
<!-- SECTION:DESCRIPTION:END -->
