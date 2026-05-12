---
id: ARV-127
title: >-
  db: migration runner — src/db/migrations/ + migrate.ts applies on first
  zond.db open
status: Done
assignee: []
created_date: '2026-05-11 10:14'
updated_date: '2026-05-11 15:25'
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
- [x] #1 src/db/migrations/0001_run_kind.sql существует
- [x] #2 src/db/migrate.ts с applyMigrations()
- [x] #3 schema_migrations table создаётся автоматически
- [x] #4 tests/db/migrate.test.ts: чистая DB + дважды apply
- [x] #5 существующая .zond/zond.db не ломается
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
src/db/migrations/0001_run_kind.sql: captures the legacy v9→v10 inline ALTER + probe/check backfill verbatim.

src/db/migrate.ts:
- applyMigrations(db, overrides?) — text-imported SQL bodies (Bun's `with { type: "text" }`), one transaction per migration, idempotent.
- schema_migrations(id TEXT PRIMARY KEY, applied_at) auto-created.
- legacySeed map (id → minUserVersion) marks pre-runner migrations as already-applied when PRAGMA user_version meets the threshold — keeps existing .zond/zond.db (user_version=10) from re-running 0001 and hitting "duplicate column".
- listShippedMigrations() exposes the manifest for tooling.

src/db/migrations/sql.d.ts: ambient module decl for `*.sql` text imports.

src/db/schema.ts: applyMigrations(db) invoked from getDb() after runMigrations(); legacy PRAGMA path retained untouched.

Tests (tests/db/migrate.test.ts, 7 cases):
- AC#3 schema_migrations created on first run
- AC#4 fresh DB + twice apply (second is no-op)
- transactional rollback: failing script doesn't leak rows; later migrations don't fire
- AC#5 legacy-seed skips on user_version >= threshold; applies on fresh DB
- listShippedMigrations contains 0001_run_kind
- end-to-end via getDb() — schema_migrations contains 0001_run_kind after open; runs.run_kind column present.

Verified: 1905 tests pass; typecheck clean; binary rebuilt, `zond db collections --json` smokes the open path on the user's existing DB (no errors).
<!-- SECTION:NOTES:END -->
