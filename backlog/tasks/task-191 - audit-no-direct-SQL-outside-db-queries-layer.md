---
id: TASK-191
title: 'audit: no direct SQL outside src/db/queries layer'
status: To Do
assignee: []
created_date: '2026-05-07 08:00'
labels:
  - audit
  - db
milestone: m-11
dependencies:
  - task-187
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
После TASK-187 (queries.ts → queries/{runs,sessions,coverage,results,settings,collections,dashboard}.ts) проверить, что вся работа с БД идёт строго через слой queries/. Ищем прямые `db.prepare(...)` / `db.query(...)` / raw SQL в:

- src/cli/commands/* (особенно doctor.ts:426, db.ts, run.ts:437)
- src/core/diagnostics/db-analysis.ts (481 строк — кандидат на утечки)
- src/ui/server/server.ts (389 строк)

Найденные нарушения: или вынести в queries/, или объяснить почему остаётся (и добавить комментарий-якорь). Цель — single source of SQL truth.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 grep по prepare/query/SELECT/UPDATE/DELETE вне src/db/ показывает только осознанные исключения
- [ ] #2 любое исключение помечено комментарием с обоснованием
- [ ] #3 db-analysis.ts либо переехал на queries/, либо объяснён
- [ ] #4 bun run check + bun test зелёные
<!-- AC:END -->
