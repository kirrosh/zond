---
id: TASK-15
title: 'T15: `.zond-current` — текущий API в workspace'
status: To Do
assignee: []
created_date: '2026-04-27'
labels:
  - T15
  - phase-3
  - size-S
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
**Зачем.** При повторении `--api <name>` в каждой команде агент тратит
впустую. Backlog.md аналогично трактует «текущую задачу» как контекст.

**Что.** Создать `src/core/context/current.ts`. Файл `.zond-current` в `cwd`
содержит имя/id коллекции. Команды (`run`, `coverage`, `request`) при
отсутствии `--api` читают этот файл. `zond use <api>` — установить.
`zond use --clear` — удалить.

**Файлы.** `src/core/context/current.ts`, `src/cli/commands/use.ts`,
обновления в `run.ts`, `coverage.ts`, `request.ts`.

**Размер.** S.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 `zond use petstore && zond run` работает без `--api petstore`
<!-- AC:END -->
