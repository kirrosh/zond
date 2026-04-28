---
id: TASK-MEDIUM.6
title: >-
  cleanup 2: rename agents-cli-full.md template, drop dead code paths in
  init/bootstrap
status: In Progress
assignee: []
created_date: '2026-04-28 12:02'
updated_date: '2026-04-28 12:39'
labels:
  - cleanup
  - refactor
  - post-drop-mcp
dependencies: []
parent_task_id: TASK-MEDIUM
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
После cleanup-1 шаблон `agents-cli-full.md` остался единственным — "cli-full" суффикс потерял смысл (нет "cli-short", нет "mcp-nudge"). Также в `bootstrap.ts` остался `if (opts.integration === "cli")` ветвление, которое после cleanup-1 становится `if (opts.writeAgents)` — упрощается.

## Scope
- Переименовать `src/cli/commands/init/templates/agents-cli-full.md` → `agents.md`.
- Обновить импорт в `agents-md.ts`.
- В `bootstrap.ts` упростить логику: `if (writeAgents) { agents = upsertAgentsBlock(cwd); }`.
- Удалить вложенный путь `src/cli/commands/init/templates/` если останется один файл — переместить плоско в `src/cli/commands/init/agents-template.md`.
- `src/cli/commands/init/markdown.d.ts` — проверить, что declaration валиден после переименования.

## Acceptance
- Шаблон называется по существу (`agents.md`, не `agents-cli-full.md`).
- Тесты зелёные.

## Связь
После cleanup-1.
<!-- SECTION:DESCRIPTION:END -->
