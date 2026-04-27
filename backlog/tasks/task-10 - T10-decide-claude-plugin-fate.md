---
id: TASK-10
title: 'T10: Решить судьбу `.claude-plugin/`'
status: To Do
assignee: []
created_date: '2026-04-27'
labels:
  - T10
  - phase-2
  - size-S
dependencies:
  - TASK-6
  - TASK-7
  - TASK-9
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
**Зачем.** Backlog.md обходится без плагина — MCP-сервер достаточно. Плагин
тяжело обновлять (см. жалобу пользователя).

**Что.** Два варианта на выбор:

**Вариант A — удалить.** Marketplace-листинг убрать, README направить на
`zond install --claude`. Плагин-маршрут — deprecated.

**Вариант B — оставить как 5-строчный шим.** В `plugin.json`:
- удалить `hooks` (они нужны были, потому что не было MCP);
- skills/commands оставить как fallback для пользователей без MCP;
- основной инсталл — через `zond install`.

Рекомендация: **A**, как только T5–T9 готовы и стабильны. До тех пор — B,
чтобы не ломать существующих пользователей.

**Файлы.** `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`,
`README.md`.

**Зависит от.** T5, T6, T7, T9.

**Размер.** S.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Вариант A: `.claude-plugin/` удалён, README не упоминает маркетплейс
- [ ] #2 Вариант B: плагин содержит только пойнтер на MCP-инсталл
<!-- AC:END -->
