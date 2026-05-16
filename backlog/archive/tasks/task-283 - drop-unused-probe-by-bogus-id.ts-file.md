---
id: TASK-283
title: drop unused probe-by-bogus-id.ts file
status: Done
assignee: []
created_date: '2026-05-09 06:59'
labels:
  - cleanup
  - m-13
milestone: m-13
dependencies: []
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Файл src/cli/commands/probe-by-bogus-id.ts (или родственный) не зарегистрирован в program.ts — мёртвый код. Удалить файл + любые import-ссылки. Источник: strategy/audit-and-consolidation.md §3.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Файл удалён
- [ ] #2 Нет ссылок в src/
- [ ] #3 Нет упоминаний в skills/, docs/, README
<!-- AC:END -->
