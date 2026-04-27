---
id: TASK-20
title: 'T20: MCP server — поддержка roots/list (workspace из клиента)'
status: To Do
assignee: []
created_date: '2026-04-27 12:39'
labels:
  - T20
  - phase-4
  - size-M
  - priority-p1
  - workspace
  - mcp
milestone: m-0
dependencies:
  - TASK-17
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
**Зачем.** Сейчас `src/mcp/server.ts` берёт cwd через `process.cwd()` процесса MCP-сервера (`src/mcp/resources/catalog-resource.ts:29`). При `~/.claude/mcp.json → zond mcp start` cwd MCP-процесса = cwd клиента (Claude Code). Это даёт правильный workspace **только** если Claude открыт в нужной папке. Если у пользователя несколько проектов в одной Claude-сессии — конфликт.

Backlog.md решает через MCP `roots/list` — клиент сообщает workspace root'ы, сервер использует их. См. `src/mcp/server.ts` Backlog.md (метод `enableRootsDiscovery()`).

**Что.**
- В `buildMcpServer` подключить `RootsListChangedNotificationSchema` handler и initial `roots/list` query (см. SDK `ListRootsResultSchema`).
- На каждый `tools/call` и `resources/read` resolve workspace root из roots, fallback на `process.cwd()`.
- `McpServerContext.cwd` стать функцией `() => string` или вычисляться per-request.

**Файлы.** `src/mcp/server.ts`, `src/mcp/resources/catalog-resource.ts`, `src/mcp/resources/diagnosis-resource.ts`, тесты в `tests/integration/mcp.test.ts`.

**Зависит от.** T17 (workspace concept).

**Размер.** M.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 MCP сервер принимает `roots/list` от клиента и кеширует roots
- [ ] #2 При `RootsListChangedNotification` от клиента — переподписаться
- [ ] #3 `zond://catalog/{api}` ищет `.api-catalog.yaml` относительно root из `roots/list`, а не process.cwd()
- [ ] #4 Если клиент не сообщает roots — поведение остаётся прежним (fallback на process.cwd())
<!-- AC:END -->
