---
id: ARV-59
title: 'audit: --deep umbrella flag (mass-assignment + security live + checks run)'
status: To Do
assignee: []
created_date: '2026-05-11 02:45'
labels:
  - audit
  - feedback-loop
  - m-16
  - depth
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Source: depth-coverage assessment, round 18-19 tester run on resend API.

`zond audit` сейчас включает только `prepare-fixtures → generate → probe static → run → coverage`. Mass-assignment, security и `checks run` (12 depth-checks) — opt-in через `--with-mass-assignment` / `--with-security`. На практике tester-агент после первого прогона (breadth ≈ 95%) не доходит до depth-passes — даёт 8 из 12 depth-checks вообще не запущенными, mass-assignment только в dry-run, security с 11/32 INCONCLUSIVE-BASE без разбора.

Replay assessment (resend): breadth 95%, depth 55%. С `--deep` потенциально 75% за +7 мин runtime.

Предложение:
- Добавить флаг `--with-checks` — отдельная stage в audit pipeline, прогоняет `zond checks run --api <name>` (без `--check` фильтра — все 12 чеков), результаты пишутся в один runs.id (через session).
- Добавить флаг `--deep` — алиас `--with-mass-assignment --with-security --with-checks`. Без флага поведение не меняется (back-compat).
- HTML-отчёт (`audit-report.html`) расширить блоком "Depth checks summary" с findings по severity.
- Coverage union в финальной stage собирает все runs одного session_id — включая checks-run row.

Reference: feedback-18, F3/F4 (UX-инициаторы); existing tasks ARV-3 (ignored_auth/use_after_free implementation), ARV-26 (schema-conformance), ARV-33 (mass-assignment auto-env), ARV-52 (mass-assignment Probe contract).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Флаг --with-checks добавлен, прогоняет 'zond checks run --api <name>' как отдельную stage
- [ ] #2 Флаг --deep алиасит --with-mass-assignment + --with-security + --with-checks
- [ ] #3 Все stages под одним session_id; coverage --union session собирает все runs
- [ ] #4 audit-report.html расширен Depth-checks summary блоком (findings by severity)
- [ ] #5 --deep без --api дружелюбно фейлится (как и базовый audit)
<!-- AC:END -->
