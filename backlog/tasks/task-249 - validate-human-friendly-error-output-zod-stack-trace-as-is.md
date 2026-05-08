---
id: TASK-249
title: 'validate: zod-stack-trace вместо human-friendly error output'
status: To Do
assignee: []
created_date: '2026-05-08 13:00'
labels:
  - feedback-loop
  - api-sentry
  - validate
  - ux
dependencies: []
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Source: feedback-07#F4, re-confirmed feedback-10 (NOT fixed), class ux-papercut.

При невалидном YAML `zond validate` печатает raw zod-issues stack (paths типа `tests.0.expect.status.0`, имена internal schema-узлов) вместо human-friendly сообщения.

Expected: либо красивый pretty-printer (path → human-readable, e.g. `tests[0].expect.status: expected number, got string "abc"`), либо хотя бы пометить «expected/received» парами как top-level message + раскрыть stack под флагом `--verbose`.

Actual: zod-trace as is, плохо читается.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria

<!-- SECTION:ACCEPTANCE:BEGIN -->
- [ ] Default validate output — компактный human-friendly формат (1-2 строки на issue: path + expected/got).
- [ ] `--verbose` сохраняет полный zod-stack для отладки.
- [ ] Regression-fixture: invalid yaml → `validate` output содержит read-able path и краткое сообщение, без `_def`/`ZodIssue`.
<!-- SECTION:ACCEPTANCE:END -->
