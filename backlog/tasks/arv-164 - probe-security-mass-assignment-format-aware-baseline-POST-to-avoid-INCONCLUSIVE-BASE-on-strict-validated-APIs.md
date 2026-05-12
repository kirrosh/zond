---
id: ARV-164
title: >-
  probe security/mass-assignment: format-aware baseline POST to avoid
  INCONCLUSIVE-BASE on strict-validated APIs
status: Done
assignee: []
created_date: '2026-05-12 12:46'
updated_date: '2026-05-12 13:11'
labels:
  - feedback-loop
  - api-stripe
  - m-16
  - probe
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Source: feedback round 09, finding F18-tail, class likely_bug.

Repro: zond probe security ssrf,crlf,open-redirect --api stripe (после ARV-161 fix формы) → 15/265 INCONCLUSIVE-BASE даже на 'normal' URL-fields; 250 SKIPPED по cleanup-feasibility. С --allow-leaks 71 INCONCLUSIVE-BASE.

Expected: baseline POST использует те же format-aware значения, что у нас уже разруливает generate (email→@example.com, url→https://example.com, country→US, mcc→5734, и т.п.). На format-validated параметрах baseline проходит, и probe видит чистый сравнительный signal payload-vs-baseline.
Actual: baseline собирается из generic random helpers ({{$randomString}}) которые Stripe отбрасывает на ранней валидации формата → endpoint отвечает 400 не на наш payload, а на baseline; probe-runner маркирует INCONCLUSIVE-BASE и не пробует payload.

Effect: 15–71 endpoint'ов unreachable для security signal на Stripe-class APIs; та же дыра должна сидеть на Twilio/GitHub form-encoded.

Fix: переиспользовать generator-cascade (или explicit format-aware fallback table) при сборке baseline body в probe-harness. См. F17 в R07-feedback (issue впервые описана там).

Log: ~/Projects/zond-test/.fb-loop/rounds/feedback-09.md §'Real ceiling без custom generators'.
<!-- SECTION:DESCRIPTION:END -->
