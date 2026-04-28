---
id: TASK-MEDIUM.5
title: 'drop-mcp 4: test cleanup + CHANGELOG breaking-change entry'
status: Done
assignee: []
created_date: '2026-04-28 10:36'
updated_date: '2026-04-28 11:41'
labels:
  - drop-mcp
  - tests
  - docs
dependencies: []
parent_task_id: TASK-MEDIUM
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Финальная очистка после drop-mcp-1/2/3.

## Scope
- Удалить `tests/integration/mcp.test.ts` и `tests/integration/mcp-tools.test.ts`.
- Прогнать `bun test` — проверить, что нет orphan-импортов / dangling-моков.
- Записать в CHANGELOG.md под следующей минорной версией секцию `### BREAKING`:
  - `zond mcp start` removed.
  - `zond install --claude/--cursor` removed.
  - `@modelcontextprotocol/sdk` dependency dropped.
  - `--integration mcp` flag of `zond init` removed.
  - Migration: agents now use the CLI directly (see AGENTS.md / skills/).
- В README/ZOND.md упомянуть decision-2 ссылкой как обоснование.

## Acceptance
- `bun test` зелёный.
- CHANGELOG.md обновлён.
- Версия в package.json bumpнута до `X.(Y+1).0` (минор — breaking).

## Связь
Эпик: decision-2. Делается ПОСЛЕ drop-mcp-1, drop-mcp-2, drop-mcp-3.
<!-- SECTION:DESCRIPTION:END -->
