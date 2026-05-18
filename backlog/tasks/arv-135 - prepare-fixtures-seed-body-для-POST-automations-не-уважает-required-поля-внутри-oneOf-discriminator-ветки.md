---
id: ARV-135
title: >-
  prepare-fixtures --seed: body для POST /automations не уважает required-поля
  внутри oneOf/discriminator-ветки
status: Done
assignee: []
created_date: '2026-05-11 17:53'
updated_date: '2026-05-16 09:21'
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

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented in data-factory.ts (m-21).

Variant selection rewritten as score-based pickBestVariant():
1) Drop type:null (3.1 nullable shorthand) unless only choice.
2) Sort by fewest UNRESOLVABLE required fields (required keys absent from properties — what the builder can't synthesise; Resend automations failed exactly here).
3) Tie-break: discriminator-tagged variant > object-with-props > more properties total > spec order (stable sort).
4) Replaced pickDiscriminatorVariant + pickPreferredVariant with this single scorer; old 'first variant with single-enum discriminator' rule no longer wins when a sibling variant is demonstrably more complete.

stampDiscriminator now honours discriminator.mapping — when picked variant lacks inline enum/const, fills from first mapping key (Stripe/Linear-style central mapping).

Tests: 5 new (data-factory.test.ts) — more-complete variant wins, discriminator tie-break, mapping fallback, F24/ARV-135 deeply-nested oneOf repro (nested config oneOf where first variant is incomplete), type:null regression. All 126 in file green incl. existing ARV-78 F25 test; 2218/2218 unit suite; tsc clean.

zond.md Phase 1 caveat (silver-bullet paragraph) rewritten — replaces 'deeply nested oneOf still 422s silently' with 'most schema shapes covered including discriminator chains; rare edge cases (server-validated externals, fields not in required+properties) escape to annotate seed_body'.
<!-- SECTION:NOTES:END -->
