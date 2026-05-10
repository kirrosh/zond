---
id: ARV-55
title: 'db: run_kind column + migration; coverage default filters non-regular runs'
status: To Do
assignee: []
created_date: '2026-05-10 18:44'
labels:
  - m-17
  - db
  - migration
  - run-kind
  - agent-contract
dependencies: []
priority: medium
milestone: m-17
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Source: feedback-12 F1 (quirk про ARV-41). ARV-41 commit обещал warning, реализация делает silent-skip — эти расхождения от того, что 'probe-only run' определяется path-эвристикой ('apis/<api>/probes/'), а не явной колонкой. Добавление run_kind делает ARV-41 silent-skip явным дизайном (не quirk'ом), и убирает эмпирическое определение типа run'а из 3 мест в коде (coverage, db diagnose, session).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Schema migration: ALTER TABLE runs ADD COLUMN run_kind TEXT NOT NULL DEFAULT 'regular' CHECK (run_kind IN ('regular','probe','check'))
- [ ] #2 Auto-fill при INSERT: regular = по умолчанию; probe = suite_path под apis/<api>/probes/; check = suite_path под apis/<api>/checks/
- [ ] #3 Migration up + down работает на existing DB (TASK-178 .zond/zond.db format)
- [ ] #4 coverage default WHERE clause фильтрует run_kind != 'probe'; ARV-41 isProbeOnlyRun() удаляется как duplicate logic
- [ ] #5 F1-12 quirk закрывается: behavior tests в tests/cli/coverage.test.ts проверяют 'after probe-run, coverage continues to use last regular run without warning'
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. db/migrations/000X_run_kind.sql (up + down).\n2. detectRunKind(suitePath: string): RunKind в core/runner/save.ts — single source of truth для классификации.\n3. SaveRun() устанавливает run_kind при INSERT.\n4. coverage queries: WHERE run_kind = 'regular'.\n5. Удалить isProbeOnlyRun() из coverage/diagnose/session.
<!-- SECTION:PLAN:END -->
