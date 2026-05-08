---
id: TASK-251
title: 'coverage: default считает только last run, нет union/session-aware default'
status: To Do
assignee: []
created_date: '2026-05-08 13:00'
labels:
  - feedback-loop
  - api-sentry
  - coverage
  - ux
dependencies:
  - TASK-242
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Source: feedback-10 new finding F3, class missing-feature (UX-bug).
Follow-up на TASK-242 (run-driven coverage).

Repro:
```
zond run apis/sentry/tests --tag negative --report json     # run #N1
zond run apis/sentry/tests --tag positive --report json     # run #N2
zond coverage --api sentry
# → coverage только по run #N2, тесты из --tag negative «потеряны» для отчёта
```

Expected: либо default = union по всем runs одной API за последнюю сессию, либо очевидное «use `zond session` to combine runs» в `coverage --help` (упомянуто в `zond session --help`, но не в `coverage --help`).

Actual: пользователь думает coverage суммарный, получает per-run. Можно использовать `--run-id`, но как сложить runs — не сказано.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria

<!-- SECTION:ACCEPTANCE:BEGIN -->
- [ ] Решение: либо default = union последней сессии (auto-detect по timestamps/PID), либо `--session` flag, либо `--combine run1,run2`.
- [ ] `coverage --help` явно упоминает как сложить несколько runs.
- [ ] Verify: 2 run'а с разными тегами → coverage показывает union, не last.
<!-- SECTION:ACCEPTANCE:END -->
