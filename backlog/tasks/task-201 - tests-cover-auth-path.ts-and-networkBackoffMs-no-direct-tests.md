---
id: TASK-201
title: 'tests: cover auth-path.ts and networkBackoffMs (no direct tests)'
status: To Do
assignee: []
created_date: '2026-05-07 10:12'
labels:
  - tests
  - runner
  - coverage
milestone: m-12
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
src/core/runner/auth-path.ts (AUTH_PATH_RE) и exported networkBackoffMs из http-client.ts не имеют прямых тестов. AUTH_PATH_RE используется --safe и diagnostics — нужен anchor на word-boundary semantics. networkBackoffMs покрыт только через executeRequest (косвенно).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 tests/runner/auth-path.test.ts: 6 кейсов — positive (each keyword: auth/login/signin/token/oauth), nested-segment, case-insensitive, false-positive ruled out (/authors не match), empty path
- [ ] #2 tests/runner/http-client.test.ts расширен: stub Math.random, проверка [0, min(cap, base*2^attempt)) на edge 0/0.999, cap clamping, integer result — 5 кейсов
<!-- AC:END -->
