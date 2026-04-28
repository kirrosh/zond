---
id: TASK-HIGH.5
title: 'drop-mcp 2: docs purge — README, ZOND.md, docs/, skills/'
status: In Progress
assignee: []
created_date: '2026-04-28 10:36'
updated_date: '2026-04-28 11:36'
labels:
  - drop-mcp
  - docs
dependencies: []
parent_task_id: TASK-HIGH
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Вычистить все упоминания MCP из публичных доков согласно decision-2.

## Scope
- README.md — убрать секции про `zond install --claude`, `zond mcp start`, MCP-tools/resources.
- ZOND.md — убрать таблицу MCP commands, оставить только CLI-таблицу.
- docs/quickstart.md, docs/INDEX.md — переписать под CLI-only flow.
- docs/backlog.md — обновить указатель (тащит исторические T5–T7 как done; добавить ссылку на decision-2).
- skills/api-scenarios/SKILL.md, skills/api-testing/SKILL.md, skills/test-diagnosis/SKILL.md, skills/setup/SKILL.md — выкинуть MCP-секции, оставить только CLI-команды.
- AGENTS.md (root) — переписать про MCP-fallback в CLI-only описание.
- CLAUDE.md — то же.
- src/mcp/resources/content/*.md — удалить вместе с папкой (см. drop-mcp-1).

## Acceptance
- `grep -rE 'MCP|mcp' README.md ZOND.md docs/ skills/` не возвращает ничего, кроме упоминания decision-2 / историчных changelog-записей.
- AGENTS.md содержит только описание CLI-пути для агентов.

## Связь
Эпик: decision-2. После drop-mcp-1.
<!-- SECTION:DESCRIPTION:END -->
