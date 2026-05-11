---
id: ARV-127
title: >-
  db: migration runner — src/db/migrations/ + migrate.ts applies on first
  zond.db open
status: To Do
assignee: []
created_date: '2026-05-11 10:14'
labels:
  - m-19
  - refactor
  - db
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
§6 refactor-plan. Прозрачные миграции SQLite. ARV-55 (run_kind колонка) добавлена inline ad-hoc. Knowledge-base (m-19+) потребует серьёзных миграций — нужен runner сейчас.

src/db/migrations/:
- 0001_run_kind.sql (перенос текущей ad-hoc up-migration)
- 0002_<next>.sql — placeholder для будущего

src/db/migrate.ts:
- applyMigrations(db) — читает schema_migrations table, применяет недостающие в lexical order
- one transaction per file
- идемпотентно

Hook в core/runner или wherever open db. Совместимость с существующими
.zond/zond.db — applyMigrations должен корректно отработать на DB, где
run_kind уже добавлена.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 src/db/migrations/0001_run_kind.sql существует
- [ ] #2 src/db/migrate.ts с applyMigrations()
- [ ] #3 schema_migrations table создаётся автоматически
- [ ] #4 tests/db/migrate.test.ts: чистая DB + дважды apply
- [ ] #5 существующая .zond/zond.db не ломается
<!-- AC:END -->
