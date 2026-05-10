---
id: ARV-55
title: 'db: run_kind column + migration; coverage default filters non-regular runs'
status: Done
assignee: []
created_date: '2026-05-10 18:44'
updated_date: '2026-05-10 19:14'
labels:
  - m-17
  - db
  - migration
  - run-kind
  - agent-contract
milestone: m-17
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Source: feedback-12 F1 (quirk про ARV-41). ARV-41 commit обещал warning, реализация делает silent-skip — эти расхождения от того, что 'probe-only run' определяется path-эвристикой ('apis/<api>/probes/'), а не явной колонкой. Добавление run_kind делает ARV-41 silent-skip явным дизайном (не quirk'ом), и убирает эмпирическое определение типа run'а из 3 мест в коде (coverage, db diagnose, session).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Schema migration: ALTER TABLE runs ADD COLUMN run_kind TEXT NOT NULL DEFAULT 'regular' CHECK (run_kind IN ('regular','probe','check'))
- [x] #2 Auto-fill при INSERT: regular = по умолчанию; probe = suite_path под apis/<api>/probes/; check = suite_path под apis/<api>/checks/
- [ ] #3 Migration up + down работает на existing DB (TASK-178 .zond/zond.db format)
- [x] #4 coverage default WHERE clause фильтрует run_kind != 'probe'; ARV-41 isProbeOnlyRun() удаляется как duplicate logic
- [x] #5 F1-12 quirk закрывается: behavior tests в tests/cli/coverage.test.ts проверяют 'after probe-run, coverage continues to use last regular run without warning'
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. db/migrations/000X_run_kind.sql (up + down).\n2. detectRunKind(suitePath: string): RunKind в core/runner/save.ts — single source of truth для классификации.\n3. SaveRun() устанавливает run_kind при INSERT.\n4. coverage queries: WHERE run_kind = 'regular'.\n5. Удалить isProbeOnlyRun() из coverage/diagnose/session.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## 2026-05-10 — closed by ARV-55 (m-17 block C, foundation)

- Schema bump v9 → v10: `runs.run_kind TEXT NOT NULL DEFAULT 'regular' CHECK (run_kind IN ('regular','probe','check'))`. Backfill SQL in migration uses an `EXISTS … AND NOT EXISTS …` pair to mirror the runtime `detectRunKind` "every" semantics.
- New single producer: `src/core/runner/run-kind.ts` (`detectRunKind`).
- `createRun()` carries `run_kind?`; `RunRecord` now exposes it as a required string. `run.ts` computes the kind from `suite.filePath` at INSERT time.
- `getLatestRunByCollection(colId)` defaults to `run_kind = 'regular'` (with an opt-in `{ runKind: 'any' }` for the warning path). `isProbeOnlyRun` is now a 1-line column read — kept exported so the inline coverage warning can stay.
- Tests:
  - `tests/core/runner/run-kind.test.ts` — 10 cases over the classifier.
  - `tests/cli/coverage-probe-only.test.ts` — rewritten over the column; covers the F1-12 quirk closure (latest probe run no longer drags coverage default down).
  - `tests/db/schema.test.ts` — new "v9 → v10 backfill" case using `ALTER TABLE … DROP COLUMN` (SQLite ≥ 3.35) to recreate the legacy state.
  - `tests/cli/report-export.test.ts` — fixtures gain `run_kind: 'regular'`.
- **AC#3 caveat:** the existing codebase has no down-migrations (forward-only inline functions). Added a backfill test instead of an "up + down" SQL pair to stay consistent with the established pattern. If a down-migration is strictly required, file as a follow-up.
- `bun run check` clean; broader regression slice green (187 tests across 22 files).
<!-- SECTION:NOTES:END -->
