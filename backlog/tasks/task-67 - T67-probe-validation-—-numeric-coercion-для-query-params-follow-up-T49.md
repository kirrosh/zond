---
id: TASK-67
title: 'T67: probe-validation — numeric coercion для query params (follow-up T49)'
status: Done
assignee: []
created_date: '2026-04-29 08:35'
updated_date: '2026-04-29 14:36'
labels:
  - bug-hunting
  - generator
milestone: m-4
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Контекст

Round 2 live-сессии нашёл B8 руками: `GET /emails?limit=1.5` → 500. TASK-49 (Done) — probe-validation покрывает type confusion в body, но **не** в query parameters: float-on-integer, negative-on-positive, NaN-style для numeric query params.

## Что сделать

Расширить probe-validation: для каждого query param с `type: integer` или `type: number`:
- 1.5 (float на integer)
- -1, 0 (negative/zero на положительное где не ожидается)
- "abc" (non-numeric)
- "" (empty string)
- null
- очень большое число (Number.MAX_SAFE_INTEGER + 1)

Аналогично для path params если spec их типизирует.

## Acceptance

- Ловит B8 (`limit=1.5` → 500) на Resend spec.
- Покрытие query + path numeric params.
- Probe deterministic.
- Тег `[probe, query-coercion]`.

## Связь

Follow-up для TASK-49 (probe-validation, Done).
<!-- SECTION:DESCRIPTION:END -->
