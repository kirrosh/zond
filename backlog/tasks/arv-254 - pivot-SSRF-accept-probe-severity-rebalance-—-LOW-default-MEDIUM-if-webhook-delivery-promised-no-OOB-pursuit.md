---
id: ARV-254
title: >-
  pivot: SSRF accept probe severity rebalance — LOW default, MEDIUM if webhook
  delivery promised, no OOB pursuit
status: To Do
assignee: []
created_date: '2026-05-15 07:04'
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
- [ ] #1 Probe 'API принял internal IP (169.254 / localhost / .internal) в webhook URL' даёт LOW по умолчанию.
- [ ] #2 MEDIUM если webhook-документация / OpenAPI spec явно описывает delivery semantics (значит сервер реально пойдёт).
- [ ] #3 HIGH ТОЛЬКО при OOB-подтверждении — но OOB infrastructure (interactsh) отдельно отложен (см. ARV-177 deferred-post-pivot).
- [ ] #4 Finding включает явный disclaimer: 'без OOB канала это accept, не proven SSRF; верифицировать через Burp Collaborator / interactsh вручную'.
- [ ] #5 Regression-fixture: mock принимает 169.254 → LOW; mock с явной webhook-spec → MEDIUM.
<!-- AC:END -->
