---
id: TASK-17
title: 'T17: Workspace root + walk-up resolution'
status: To Do
assignee: []
created_date: '2026-04-27 12:38'
labels:
  - T17
  - phase-4
  - size-M
  - priority-p0
  - workspace
milestone: m-0
dependencies:
  - TASK-12
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
**Зачем.** Сейчас `zond.db` создаётся в `process.cwd()` (`src/db/schema.ts:8-9`), команды не имеют понятия «workspace root». Если Claude Code открыт в `~/`, появится `~/zond.db`. Если `zond run` запущен из subfolder — он не найдёт parent'овский `zond.db`. Backlog.md решает это через `resolveBacklogDirectory()` walk-up.

**Что.** Ввести понятие workspace root через маркер-файл (предлагается `zond.config.yml` — пересекается с T12, либо `.zond/` директория). Walk-up от cwd ищет ближайший маркер. Если не найден — fallback на cwd с warning'ом для UX.

Resolution коснётся:
- `zond.db` path (если не передан `--db`)
- `apis/<name>/` directory base
- `.zond-current` (T15) — читать от workspace root, не cwd
- `.env.yaml` discovery (см. T21)
- MCP server cwd (см. T20)

**Файлы.** `src/core/workspace/root.ts` (новый), `src/db/schema.ts` (resolveDbPath), `src/core/setup-api.ts`, `src/core/context/current.ts` (T15 — обновить readCurrentApi), CLI команды `run/coverage/request/serve`.

**Зависит от.** TASK-12 (zond.config.yml) — либо T17 предшествует и определяет marker, либо они делаются вместе.

**Размер.** M.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 `findWorkspaceRoot(cwd)` walk-up'ом возвращает абсолютный путь до ближайшего маркер-файла, либо null
- [ ] #2 `zond run` запущенный из subfolder использует `<root>/zond.db` (или путь из config), не `<subfolder>/zond.db`
- [ ] #3 `zond.db` НЕ создаётся в HOME-директории если рядом есть workspace marker сверху по дереву
- [ ] #4 Документировано: что считается маркером, что происходит без маркера (warning + fallback)
<!-- AC:END -->
