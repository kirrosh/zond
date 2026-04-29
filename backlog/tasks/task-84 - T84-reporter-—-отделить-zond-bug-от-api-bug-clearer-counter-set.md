---
id: TASK-84
title: 'T84: reporter — отделить zond-bug от api-bug + clearer counter-set'
status: To Do
assignee: []
created_date: '2026-04-29 08:41'
labels:
  - reporter
  - ux
milestone: m-3
dependencies: []
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Контекст

В одном run-е probe-pagination limit=1.5 → 500 (api-bug) и --safe --json → ошибка пути (zond-bug, T68) выглядят одинаково. Пользователь сам соображает что это разные классы.

Также: текущий counter "26 passed, 19 failed, 2 5xx, 10 skipped" — '2 5xx' это подмножество failed или отдельный класс? Сумма 26+19+10=55 = total, значит подмножество. Лучше: "Total: 55 (26 passed, 19 failed [incl. 2 server errors], 10 skipped)".

## Что сделать

1. Категоризация: zond-error (network, YAML parse, runner panic) — отдельно от assertion-fail.
2. Reporter в console и JSON-report использует категории.
3. Counter-set human-readable: подкатегории в скобках, total-сумма явная.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Failures классифицируются: api-error (5xx сервера), assertion-fail (контракт), zond-error (network/parse/runtime в zond)
- [ ] #2 Counter-set: 'Total: 55 (26 passed, 19 failed [2 server errors, 1 zond error], 10 skipped)'
- [ ] #3 JSON-report: каждое failure имеет category-поле
<!-- AC:END -->
