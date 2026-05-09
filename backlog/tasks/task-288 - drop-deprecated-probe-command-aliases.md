---
id: TASK-288
title: drop deprecated probe-* command aliases
status: Done
assignee: []
created_date: '2026-05-09 06:59'
labels:
  - cleanup
  - cli-surface
  - m-13
  - breaking
milestone: m-13
dependencies: []
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
После TASK-182 (zond probe <class> umbrella) старые алиасы probe-validation/probe-methods/probe-mass-assignment/probe-security помечены deprecated. Удалить алиасы в текущем мажоре. Источник: audit-and-consolidation.md §3.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Алиасы probe-* удалены из program.ts
- [ ] #2 skills/, docs/ обновлены: только zond probe <class>
- [ ] #3 CHANGELOG.md breaking-change запись
<!-- AC:END -->
