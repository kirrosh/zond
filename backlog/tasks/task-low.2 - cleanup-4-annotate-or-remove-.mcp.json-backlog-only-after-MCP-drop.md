---
id: TASK-LOW.2
title: 'cleanup 4: annotate or remove .mcp.json (backlog-only after MCP drop)'
status: In Progress
assignee: []
created_date: '2026-04-28 12:02'
updated_date: '2026-04-28 12:45'
labels:
  - cleanup
  - docs
  - post-drop-mcp
dependencies: []
parent_task_id: TASK-LOW
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
После decision-2 `.mcp.json` в корне репо остался — но он содержит ТОЛЬКО backlog MCP-сервер (для агентов, которые работают с backlog через MCP). Это создаёт путаницу: видя файл, новый разработчик подумает, что zond-MCP жив.

## Scope
- Решить, оставлять ли `.mcp.json` в репо вообще:
  - PRO: разработчики и агенты, использующие backlog через MCP (`backlog.task_list` etc.), получают авто-config.
  - CON: zond сам отказался от MCP (decision-2) — выглядит противоречиво.
- Варианты:
  a) Оставить, добавить в файл `_comment` (если JSON позволяет — нет, не позволяет; тогда README sibling-line).
  b) Удалить из репо, добавить в `.gitignore`. Каждый разработчик сам себе пропишет, если хочет.
  c) Переименовать в `.mcp.example.json` + .gitignore .mcp.json (обычная практика для шаблонов).
- Рекомендация: (c) — явно даёт сигнал "опционально, скопируй и используй".
- Обновить `AGENTS.md` / `docs/backlog.md` — упомянуть, что `.mcp.example.json` — это ОПЦИОНАЛЬНАЯ обвязка для backlog, не интеграция zond.

## Acceptance
- Репо не содержит активного `.mcp.json` (или он явно помечен).
- AGENTS.md / docs объясняют, что это про upstream backlog, а не про zond.

## Связь
Хвост decision-2.
<!-- SECTION:DESCRIPTION:END -->
