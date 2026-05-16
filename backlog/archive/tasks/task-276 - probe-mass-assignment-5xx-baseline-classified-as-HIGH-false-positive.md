---
id: TASK-276
title: >-
  probe-mass-assignment: 5xx-baseline классифицируется как HIGH (false-positive
  privilege-escalation)
status: Done
assignee:
  - '@me'
created_date: '2026-05-08 19:00'
updated_date: '2026-05-08 13:01'
labels:
  - feedback-loop
  - api-sentry
  - probe
  - security
  - bug
dependencies:
  - TASK-91
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Source: feedback-14#F1, class false-positive (HIGH severity → масштабирует впустую час времени security-инженера).

TASK-91 ввёл бакет `INCONCLUSIVE-baseline` для 4xx-baseline. 5xx-baseline в эту ветку не попадает: probe-mass-assignment всё ещё классифицирует endpoints с baseline 5xx как HIGH «privilege escalation candidates».

Repro (Sentry, feedback-14):
- PUT `/issues/`, PUT `/issues/{id}/`, PUT `/projects/{}/{}/issues/`, PUT `/members/{id}/` — baseline 502, with-extras 502, per-field "unknown".
- Все 4 — те же 502/500 endpoints из validation-probe (server crash на bulk PUT / bad path-id).
- В digest: `4 HIGH privilege escalation candidates`. Реальной mass-assignment здесь нет — endpoint просто крашится.

Expected: baseline ≥500 → классифицировать как `INCONCLUSIVE-5XX` (не HIGH). HIGH должно означать «поле принято и применилось», а не «сервер упал».

Impact: security-инженер видит 4 «P0 privilege escalation» и тратит час, чтобы понять, что это дубликат validation-багов. Скрывает реальные HIGH под шумом.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria

<!-- SECTION:ACCEPTANCE:BEGIN -->
- [ ] Новый бакет `inconclusive-5xx` (или расширение `inconclusive-baseline`) для baseline ≥500.
- [ ] Markdown digest: endpoints в этом бакете отдельной секцией с подсказкой «baseline 5xx — endpoint крашится, validation-probe вероятно зарепортил тот же баг».
- [ ] `emitRegressionSuites` skipает `inconclusive-5xx`.
- [ ] Tests: baseline 5xx + with-extras 5xx → INCONCLUSIVE-5XX (не HIGH); baseline 5xx + with-extras 2xx → HIGH (необычный extras-bypass, оставить как HIGH с пометкой «server crash on baseline»).
- [ ] Verify на Sentry feedback-14: 4 HIGH → 4 INCONCLUSIVE-5XX в digest.
<!-- SECTION:ACCEPTANCE:END -->
