---
id: TASK-232
title: generate --tag возвращает пустой список без объяснения когда тег не совпадает
status: Done
assignee: []
created_date: '2026-05-08 07:56'
labels:
  - feedback-loop
  - api-sentry
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Source: feedback round 03, finding F4, class likely_bug
Repro: zond generate --api sentry --output apis/sentry/tests --tag Members (при том что --tag Organizations работает)
Expected: чувствительность к регистру/whitespace, или подсказка 'no endpoints with tag Members — available tags: ...'
Actual: No endpoints to generate tests for. — без объяснения; теги в spec.json существуют (Member, Organizations), но Members не матчится. Невозможно отличить опечатку от реального отсутствия
Log: /tmp/zond-fb/sentry/rounds/raw-03.log (=== generate --tag Members ===)
<!-- SECTION:DESCRIPTION:END -->
