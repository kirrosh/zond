---
id: TASK-5
title: 'T5: Добавить `zond mcp start` — entry-point MCP-сервера'
status: Done
assignee:
  - '@claude'
created_date: '2026-04-27'
updated_date: '2026-04-27 10:42'
labels:
  - T5
  - phase-1
  - size-M
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
**Зачем.** Снять привязку к Claude Code-плагину, дать портативность на Cursor,
Codex, Gemini CLI, Kiro.

**Что.**
1. Добавить `@modelcontextprotocol/sdk` в dependencies.
2. Создать `src/mcp/server.ts` — `startMcpServer({stdio: true})`.
3. Создать команду `src/cli/commands/mcp.ts` с подкомандой `start`.
4. Зарегистрировать в `src/cli/index.ts`.
5. Обработка `--db <path>` для общей БД.
6. На запуске — стандартный MCP handshake (`initialize`, `tools/list`,
   `resources/list`).

**Файлы.** `src/mcp/server.ts`, `src/mcp/index.ts`, `src/cli/commands/mcp.ts`,
`src/cli/index.ts`, `package.json`.

**Размер.** M.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 `echo '{"jsonrpc":"2.0","id":1,"method":"initialize",...}' | zond mcp start` отдаёт корректный response
- [x] #2 `tools/list` и `resources/list` работают (пусть с заглушкой)
<!-- AC:END -->
