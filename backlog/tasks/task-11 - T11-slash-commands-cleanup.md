---
id: TASK-11
title: 'T11: Slash-команды (`/test-api`, `/diagnose`, `/smoke`)'
status: To Do
assignee: []
created_date: '2026-04-27'
labels:
  - T11
  - phase-2
  - size-S
dependencies:
  - TASK-10
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
**Зачем.** После MCP-инсталла Claude Code сам разберётся через тулзы и
ресурсы, slash-команды-обёртки не нужны.

**Что.** Удалить `commands/diagnose.md`, `commands/smoke.md`.
`commands/test-api.md` оставить как «human entry-point» (1–2 строки делегации
в скилл) или удалить.

**Файлы.** `commands/*.md`, `.claude-plugin/plugin.json`.

**Зависит от.** T10 (вариант B), либо после A — с этим вообще пропадает.

**Размер.** S.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 В `commands/` либо пусто, либо один тонкий файл
<!-- AC:END -->
