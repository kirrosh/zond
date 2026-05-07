---
id: TASK-191
title: 'audit: no direct SQL outside src/db/queries layer'
status: Done
assignee: []
created_date: '2026-05-07 08:00'
updated_date: '2026-05-07 08:45'
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
- [x] #1 grep по prepare/query/SELECT/UPDATE/DELETE вне src/db/ показывает только осознанные исключения — **0 нарушений**
- [x] #2 любое исключение помечено комментарием с обоснованием — N/A (нарушений нет)
- [x] #3 db-analysis.ts либо переехал на queries/, либо объяснён — использует только getDb() + listCollections/listRuns/getRunById/getResultsByRunId/getCollectionById, никаких prepare()
- [x] #4 bun run check + bun test зелёные (проверено в TASK-188)
<!-- AC:END -->

## Notes

<!-- SECTION:NOTES:BEGIN -->
**Финальный grep:**
- `grep -rE "(SELECT |INSERT INTO|UPDATE [a-z_]+ SET|DELETE FROM)" src/ --include="*.ts" | grep -v src/db/` → **пусто**
- `grep -rE "\.(prepare|query|exec|all|get|run)\(" src/ --include="*.ts" | grep -v src/db/` → только regex `.exec()` (CASCADE_RE, pathParamRe), не SQL

**Side findings (не входят в scope, оставлены для будущего follow-up):**
1. **28 файлов всё ещё импортируют фасад** `src/db/queries.ts` (per-domain миграция планировалась TASK-187 на «следующий минорный релиз»). Кандидат на отдельную задачу: миграция импортов перед удалением фасада.
2. **`getDb(path?)` вызывается ради побочного эффекта** (без присваивания) в 8+ местах: generate.ts, coverage.ts, run.ts, doctor.ts, db.ts, server.ts. Имя вводит в заблуждение — функция и инициализирует, и возвращает. Кандидат на переименование в `ensureDb()` / разделение на `initDb()`+`getDb()`.
<!-- SECTION:NOTES:END -->
