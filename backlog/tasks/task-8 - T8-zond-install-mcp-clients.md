---
id: TASK-8
title: 'T8: `zond install --claude --cursor --codex --gemini`'
status: To Do
assignee: []
created_date: '2026-04-27'
labels:
  - T8
  - phase-1
  - size-M
dependencies:
  - TASK-5
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
**Зачем.** One-command onboarding под все MCP-агенты.

**Что.** Команда `zond install` детектит установленные агенты (наличие
`~/.claude/`, `~/.cursor/`, `~/.codex/` и т.п.) и предлагает прописать
MCP-сервер в их конфиги. Флаги — для явного выбора. По умолчанию —
interactive prompt (после T11).

Конфиг для Claude Code:
```jsonc
// ~/.claude/mcp.json
{ "mcpServers": { "zond": { "command": "zond", "args": ["mcp", "start"] } } }
```
Аналогично для остальных — формат у каждого свой, надо зашить шаблоны.

**Файлы.** `src/cli/commands/install.ts`, `src/cli/index.ts`,
`src/core/install/{claude,cursor,codex,gemini}.ts`.

**Зависит от.** T5.

**Размер.** M.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 `zond install --claude` создаёт/обновляет `~/.claude/mcp.json`
- [ ] #2 Запускается sanity-check `tools/list` через нового клиента
<!-- AC:END -->
