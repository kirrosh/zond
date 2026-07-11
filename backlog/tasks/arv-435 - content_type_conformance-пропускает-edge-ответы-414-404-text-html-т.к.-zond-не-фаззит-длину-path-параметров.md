---
id: ARV-435
title: >-
  content_type_conformance пропускает edge-ответы (414/404 text/html), т.к. zond
  не фаззит длину path-параметров
status: To Do
assignee: []
created_date: '2026-07-11 08:37'
labels:
  - m-28
  - contract-drift
dependencies: []
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Из ARV-407 (parity vs Schemathesis на Stripe): ST фаззил path-params до мегабайтных длин и словил 414 URI Too Long / 404, которые Stripe отдаёт как text/html|text/plain вместо application/json — реальный mild content-type drift. У zond есть сам чек content_type_conformance, но детерминированный кейс-генератор никогда не порождает oversized path-param, поэтому 414 не триггерится и drift не виден. Детерминированный, ложится в литмус: добавить один boundary-кейс (oversized path segment) в coverage-фазу content_type_conformance. Не фаззер — один граничный кейс.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Coverage-фаза генерирует хотя бы один oversized path-segment кейс на byid-операциях
- [ ] #2 content_type_conformance ловит non-JSON edge-ответы (414/некоторые 404) на Stripe-подобной цели
<!-- AC:END -->
