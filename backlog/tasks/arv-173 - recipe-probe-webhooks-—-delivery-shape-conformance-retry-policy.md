---
id: ARV-173
title: recipe + probe webhooks — delivery + shape conformance + retry policy
status: To Do
assignee: []
created_date: '2026-05-12 12:49'
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
