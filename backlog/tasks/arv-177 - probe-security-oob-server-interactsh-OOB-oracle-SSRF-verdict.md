---
id: ARV-177
title: 'probe security --oob-server: interactsh OOB-oracle SSRF verdict'
status: To Do
assignee: []
created_date: '2026-05-12 13:27'
labels:
  - m-18
  - security
  - probe
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Цель

Блок C m-18. Закрыть 4 LOW SSRF на Sentry (symbol-sources) явным вердиктом
вместо `verify manually`.

Флаг `zond probe security --oob-server <url>` инжектит OOB callback URL
(DNS/HTTP, под interactsh-домен) в SSRF payloads. После probe-раунда —
poll OOB log; callback от target API → confirmed HIGH; нет callback после
timeout → confirmed FP.

## Поведение

- URL генерится уникально per request (для корреляции finding ↔ callback)
- correlation-id хранится вместе с finding в `results`
- после probe zond ждёт N секунд (configurable), poll'ит OOB API,
  обновляет verdict в findings
- если `--oob-server` не указан — текущий behavior (verify manually)

## Зависимости

- ARV-178 — recipe-документация для interactsh
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 probe security --oob-server <url> инжектит OOB URL в SSRF payloads с уникальным correlation-id
- [ ] #2 после probe zond polls OOB log и обновляет verdict (confirmed HIGH / confirmed FP)
- [ ] #3 4 LOW SSRF на Sentry получают явный вердикт после прогона
<!-- AC:END -->
