---
id: ARV-254
title: >-
  pivot: SSRF accept probe severity rebalance — LOW default, MEDIUM if webhook
  delivery promised, no OOB pursuit
status: Done
assignee: []
created_date: '2026-05-15 07:04'
updated_date: '2026-05-15 09:32'
labels:
  - m-21
  - pivot
  - probe
  - ssrf
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Контекст

Сейчас "API принял 169.254" бьёт HIGH. Без out-of-band проверки доставки это гадание. ARV-177 (OOB-server интеграция) снят с m-21 как Burp-территория. Здесь — просто честный severity без OOB.

## Цель

Для маленькой команды полезен сам флаг "вы принимаете internal IP в webhook URL" как wake-up call, но не как HIGH. LOW дефолтом + явный disclaimer о том, что нужна ручная OOB-верификация.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Probe 'API принял internal IP (169.254 / localhost / .internal) в webhook URL' даёт LOW по умолчанию.
- [x] #2 MEDIUM если webhook-документация / OpenAPI spec явно описывает delivery semantics (значит сервер реально пойдёт).
- [x] #3 HIGH ТОЛЬКО при OOB-подтверждении — но OOB infrastructure (interactsh) отдельно отложен (см. ARV-177 deferred-post-pivot).
- [x] #4 Finding включает явный disclaimer: 'без OOB канала это accept, не proven SSRF; верифицировать через Burp Collaborator / interactsh вручную'.
- [x] #5 Regression-fixture: mock принимает 169.254 → LOW; mock с явной webhook-spec → MEDIUM.
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
SSRF / open-redirect severity rebalanced under the no-OOB constraint. classifyInner now receives endpoint ctx and routes the 2xx-accept case via endpointDeclaresDelivery() heuristic (path or tag matches /webhook|callback|subscription/). Four-case matrix: (a) plain endpoint, URL echoed → LOW with OOB disclaimer; (b) plain endpoint, URL accepted no echo → LOW with OOB disclaimer; (c) delivery-declared endpoint, URL accepted → MEDIUM with OOB disclaimer; (d) HIGH reserved for OOB confirmation, deferred-post-pivot via ARV-177. Every finding reason includes 'no OOB channel — accept ≠ proven fetch. Verify with Burp Collaborator / interactsh manually for HIGH severity.' SecuritySeverity union extended with 'medium' tier; verdict roll-up, summaryLine, digest titles, SEC_BUCKETS/SEC_SUMMARY/SEC_ZERO updated. security-probe-class.ts collapses medium → low on the public ProbeFindingSeverity wire (MEDIUM is digest-only by design, must not gate CI as HIGH). open-redirect test updated to expect LOW. 4-test regression at tests/core/probe/ssrf-severity-rebalance.test.ts covers all four cases including tag-based delivery detection.
<!-- SECTION:FINAL_SUMMARY:END -->
