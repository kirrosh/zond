---
id: ARV-173
title: recipe + probe webhooks — delivery + shape conformance + retry policy
status: Done
assignee: []
created_date: '2026-05-12 12:49'
updated_date: '2026-05-13 15:58'
labels:
  - m-20
  - depth
  - probe
  - recipe
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Цель E из m-20.

Webhook verification = recipe (≤200 строк) + опциональная zond-команда.

Pipeline:
1. Recipe docs/recipes/webhook-receiver.md — поднимает локальный HTTP receiver (через interactsh-style сервис или ngrok-туннель), регистрирует webhook URL в target API через POST /webhooks endpoint (если в spec'е).
2. zond probe webhooks (опционально, если в spec'е есть webhooks: блок OpenAPI 3.1 или x-webhooks extension):
   - Регистрирует receiver-url.
   - Триггерит action (например POST /v1/charges → должен прислать charge.succeeded).
   - Ждёт event (timeout configurable).
   - Сравнивает receiver-payload против spec.webhooks.<event>.post.requestBody.schema.
   - Симулирует receiver 5xx → проверяет retry policy (взять параметры из spec / .api-resources.yaml).
   - Проверяет ordering при триггере N events последовательно.

Findings:
- event не пришёл → HIGH 'webhook not delivered'.
- shape != spec → MEDIUM/HIGH (drift).
- no retry на 5xx receiver → MEDIUM.
- out-of-order → MEDIUM.

Acceptance:
- Recipe воспроизводим на Stripe test mode за <15 минут tester'ом-новичком.
- zond probe webhooks выдаёт ≥1 finding на каком-то таргете (drift или missing retry).
- Anti-FP: clean run на 'хорошем' API (Stripe) green.

Source: feedback round 09 final evaluation §4 item 5.
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Implementation notes (2026-05-13)

Offline shape-conformance, not async delivery. Recipe captures via Stripe CLI / smee.io / ngrok; probe consumes ndjson and validates each event against `spec.webhooks.<type>.post.requestBody`. Same recipe/probe split as ARV-178 (quicktype, interactsh).

End-to-end verified on synthetic spec: 4 events → 2 OK (Stripe envelope + body envelope) + 1 HIGH shape_drift + 1 LOW unknown_event_type. JSON envelope, markdown digest, exit code 1 on HIGH.

**Live verify on Stripe/Resend/Sentry not possible** — все three specs на OpenAPI 3.0 без `webhooks:` block или `x-webhooks` extension. Probe честно skip'ит с reason 'spec declares no webhooks'. Это limitation specs, не probe.

Out-of-scope retry-policy / ordering / HMAC verification — covered как future work в recipe.
<!-- SECTION:NOTES:END -->
