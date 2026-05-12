---
id: ARV-135
title: >-
  prepare-fixtures --seed: body для POST /automations не уважает required-поля
  внутри oneOf/discriminator-ветки
status: To Do
assignee: []
created_date: '2026-05-11 17:53'
labels:
  - feedback-loop
  - api-resend
  - m-17
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Source: feedback round 11 (fb-01), finding F4, severity MEDIUM, class missing-feature. Follow-up ARV-67 / ARV-78.

Repro: zond prepare-fixtures --api resend --seed --apply (fresh init).
  Seed-body curl-репро (prepare-fixtures печатает):
    POST /automations -d '{"name":"Emma Davis","status":"enabled",
      "steps":[{...}],"connections":[{...}]}'
  Сервер: 422 Missing 'steps, config, event_name' field.
  В body есть `steps`, но нет `config` и `event_name` — обязательных полей под одной из веток oneOf/discriminator для trigger-схемы.

Expected: seed-генератор обходит request-body schema рекурсивно, для oneOf/anyOf/discriminator выбирает ветку, у которой required-поля резолвятся (есть defaults/examples), и заполняет required-поля внутри выбранной ветки.

Actual: видимо выбирается первый вариант без проверки «все required-поля резолвимы в этой ветке». Один и тот же 422 повторяется в каждом cascade-pass; финал — «no-progress» exit. Блокирует automation_id и каскадно — CRUD-сьюты по automations.

ARV-67 (top-level required) и ARV-78 (nested) сделаны, но automations schema падает дальше — оставшийся gap по deeply-nested discriminator (упомянуто в ARV-94 как known-limitation).

Log: ~/Projects/zond-test/.fb-loop/rounds/raw-01.log (Seed attempts), apis/resend/spec.json paths./automations request-body.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 seed body builder для oneOf/anyOf выбирает ветку с наименьшим числом нерезолвимых required-полей
- [ ] #2 discriminator-поле получает значение по mapping (или первый ключ, если mapping отсутствует), затем body заполняется по схеме выбранной ветки
- [ ] #3 regression: POST /automations seed-attempt у resend перестаёт получать 422 'Missing steps/config/event_name'
- [ ] #4 если ни одна ветка oneOf не резолвится — explicit miss-reason 'unresolvable-discriminator-branch' (не silent skip)
<!-- AC:END -->
