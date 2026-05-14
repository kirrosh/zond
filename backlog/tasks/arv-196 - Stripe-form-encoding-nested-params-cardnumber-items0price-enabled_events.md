---
id: ARV-196
title: >-
  Stripe form-encoding nested params: card[number], items[0][price],
  enabled_events[]
status: To Do
assignee: []
created_date: '2026-05-13 19:19'
labels:
  - m-21
  - seed-bodies
  - stripe
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
prepare-fixtures --seed POSTит body как flat key/value. Stripe требует bracket notation для nested. Корневая причина 57/69 broken-baseline на Stripe cross_call_references. Закрытие m-20 done-criteria #1.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Serializer в seed/POST-create code path поддерживает nested keys: foo[bar]=v, list[0]=v
- [ ] #2 annotated seed_body в .api-resources.local.yaml допускает nested структуру (YAML map → bracket notation на serialize)
- [ ] #3 prepare-fixtures --seed --apply на Stripe фактически создаёт ≥10 новых ресурсов (cards, items, sources, payment_methods через card[number], subscriptions через items[0][price])
- [ ] #4 cross_call_references на Stripe даёт ≥3 findings (закрытие m-20 done-criteria #1)
- [ ] #5 Regression-fixture в tests/: bracket-notation roundtrip parse + serialize
<!-- AC:END -->
