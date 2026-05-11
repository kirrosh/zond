---
id: ARV-123
title: 'anti-fp: core/anti-fp registry — FpRule interface + applyAntiFp() helper'
status: Done
assignee: []
created_date: '2026-05-11 10:14'
updated_date: '2026-05-11 10:22'
labels:
  - m-19
  - refactor
  - anti-fp
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
§2 refactor-plan, lesson §F. Anti-FP guards разбросаны: checks/_anti_fp.ts (4 schemathesis-FP правила) + mass-assignment-probe.ts inline regex + security-probe.ts inline check. Нет общего реестра, нет attribution к источнику (schemathesis #N / Sentry plan-limit doc).

src/core/anti-fp/:
- types.ts: FpRule { id, scope, applies(ctx), reason, references[] }
- registry.ts: register/get/list
- index.ts: applyAntiFp(finding, ctx) -> FpSuppression | null
- rules/ (пустой, наполняется отдельными task'ами)

Этот task — только infrastructure + пустой registry. Миграция правил —
отдельные задачи.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 core/anti-fp/types.ts с FpRule interface
- [x] #2 core/anti-fp/registry.ts с register/get/list
- [x] #3 core/anti-fp/index.ts с applyAntiFp() helper
- [x] #4 tests/core/anti-fp/registry.test.ts — register/dedup/scope-filter
<!-- AC:END -->
