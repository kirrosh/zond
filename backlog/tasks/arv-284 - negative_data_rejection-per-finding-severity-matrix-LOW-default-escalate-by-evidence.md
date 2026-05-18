---
id: ARV-284
title: >-
  negative_data_rejection: per-finding severity matrix (LOW default + escalate
  by evidence)
status: To Do
assignee: []
created_date: '2026-05-18 10:21'
labels:
  - severity
  - calibration
  - proof-cap
  - ARV-250
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Контекст

`negative_data_rejection` декларирован `severity: 'high'` hardcoded — но это противоречит unified severity matrix из ARV-250: `capSeverityByProof` для `single_signal` (один request показал 'server accepted invalid body, outcome unknown') → cap LOW. HIGH резервируется под `evidence_chain`. У этого check evidence ровно один — response на mutation. Per `project_zond_positioning_pivot`: no evidence → no high severity.

Stripe ARV-282 scan показал результат: 100 HIGH findings, все calibration-агентом demoted до MEDIUM ручную. ARV-283 (severity config) разблокировал per-API override, но это compensation за неверный baseline.

## Решение

`CheckOutcome.fail` extended с optional `severity?: Severity` (опционально per-finding override). `negative_data_rejection.run()` dispatches severity по `evidence.mutation`:

- **MEDIUM** (concrete schema breach silently accepted): `maxLength+1`, `minLength-1`, `pattern-violation`, `uuid-invalid`, `email-invalid`, `date-invalid`, `uri-invalid`, `drop-required:*`, `drop-required-query`, wrong-type query на не-GET, wrong-type path
- **LOW** (vendor by-design / ambiguous intent): `additionalProperties-violation` (Stripe-style silent drop), `wrong-type` query на GET (vendor "invalid id → empty list" pattern)

5xx остаётся в `not_a_server_error` ownership — `negative_data_rejection.ACCEPTABLE` уже passes для 5xx чтобы избежать double-counting.

Declared `Check.severity = 'low'` — это proof-cap baseline. Per-finding override на MEDIUM эскалирует для concrete breach. ARV-283 config переопределяет сверху для vendor-specific calibration.

## Acceptance Criteria

- [x] #1 `CheckOutcome.fail` принимает optional `severity?: Severity` field. Runner.recordFinding принимает `outcomeSeverity?` параметром и использует его если задан, иначе `check.severity`.
- [x] #2 `negative_data_rejection` декларирует `severity: 'low'`. `run()` возвращает per-finding severity по `evidence.mutation.boundary` (body) / `evidence.mutation.param_scenario+param_location+method` (params) согласно матрице выше.
- [x] #3 Регрессионный тест `tests/core/checks/negative-data-rejection-severity.test.ts` лочит матрицу: 11 cases (default severity, 5xx → pass not finding, additionalProperties → LOW, maxLength+1 → MEDIUM, pattern → MEDIUM, format → MEDIUM, drop-required → MEDIUM, wrong-type GET query → LOW, wrong-type POST query → MEDIUM, drop-required-query → MEDIUM, unknown mutation → LOW).
- [x] #4 Stripe ARV-282 dataset baseline: 100 HIGH → 0 HIGH, 42 MEDIUM (`maxLength+1`), 55 LOW (vendor patterns). Все 734 unit tests pass.

## Связано

- ARV-250 (severity matrix overhaul — proof-cap rules)
- ARV-283 (severity config — теперь работает как vendor-overlay, не как costyl)
- ARV-282 (Stripe scan — source dataset)
- project_zond_positioning_pivot (no evidence → no high severity)

## Possible follow-up

`status_code_conformance`, `ignored_auth`, `cross_call_references`, `pagination_invariants` — те же check'и с hardcoded HIGH. Применить аналогичный per-finding dispatch для каждого где evidence varies. Это не делается в этой задаче — нужен per-check audit что mutation/evidence shape позволяет надёжный дифференциал.
<!-- SECTION:DESCRIPTION:END -->
