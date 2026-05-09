---
id: TASK-187
title: 'refactor: split src/db/queries.ts by domain'
status: Done
assignee: []
created_date: '2026-05-07 06:49'
updated_date: '2026-05-07 07:28'
labels:
  - refactor
  - db
milestone: m-11
dependencies: []
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
queries.ts разрослась после m-6 (sessions, coverage, cascade) и m-10 (redaction). Порезать по доменам: src/db/queries/runs.ts, sessions.ts, coverage.ts, settings.ts. Index-файл как фасад для обратной совместимости импортов на 1 релиз. Связка с knip-cleanup (TASK-179) — часть unused exports именно отсюда.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 src/db/queries/{runs,sessions,coverage,settings,results}.ts существуют
- [x] #2 src/db/queries.ts остался как фасад (re-exports), будет удалён в следующем релизе
- [x] #3 bun run check + bun test зелёные
<!-- AC:END -->
