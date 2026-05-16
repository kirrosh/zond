---
id: ARV-196
title: >-
  Stripe form-encoding nested params: card[number], items[0][price],
  enabled_events[]
status: Done
assignee: []
created_date: '2026-05-13 19:19'
updated_date: '2026-05-15 12:41'
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
- [x] #1 Serializer в seed/POST-create code path поддерживает nested keys: foo[bar]=v, list[0]=v
- [x] #2 annotated seed_body в .api-resources.local.yaml допускает nested структуру (YAML map → bracket notation на serialize)
- [ ] #3 prepare-fixtures --seed --apply на Stripe фактически создаёт ≥10 новых ресурсов (cards, items, sources, payment_methods через card[number], subscriptions через items[0][price])
- [ ] #4 cross_call_references на Stripe даёт ≥3 findings (закрытие m-20 done-criteria #1)
- [x] #5 Regression-fixture в tests/: bracket-notation roundtrip parse + serialize
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Bracket-notation сериализатор encodeFormBody уже существовал (ARV-149/150) и поддерживает nested keys + indexed arrays (card[number], items[0][price], expand[0]). Корневой баг был в src/cli/commands/bootstrap.ts:274 — seed POST всегда слал JSON.stringify(body) независимо от ep.requestBodyContentType. Фикс: проверка content-type, для application/x-www-form-urlencoded используем encodeFormBody; curl-repro мирорит wire-body. Regression-тест tests/regression/seed-form-encoding.test.ts — Bun-mock сервер + Stripe-style spec (POST /v1/customers с nested address и array expand) проверяет что body уходит в form-encoded виде с address[line1]= и expand[0]= (не JSON). AC #1 (serializer), #2 (yaml→bracket), #5 (regression) закрыты. AC #3, #4 требуют живого Stripe-аккаунта — оставлены в backlog как verification-задачи.
<!-- SECTION:FINAL_SUMMARY:END -->
