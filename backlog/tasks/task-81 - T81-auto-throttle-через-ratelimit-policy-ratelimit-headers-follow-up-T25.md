---
id: TASK-81
title: >-
  T81: auto-throttle через ratelimit-policy / ratelimit-* headers (follow-up
  T25)
status: To Do
assignee: []
created_date: '2026-04-29 08:41'
labels:
  - runner
  - robustness
milestone: m-1
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Контекст

Top-5 ROI fix. T25 (Done) сделал --rate-limit и Retry-After на 429. Но не читает proactive ratelimit-* headers.

Round 2: 154 из 612 probe-validation запросов поймали 429 потому что rate-limit угадан вручную. Probe-режим на любом продакшен-API даёт ложные failures от rate-limit'а вперемежку с настоящими находками.

## Что сделать

1. После каждого ответа парсить:
   - `ratelimit-limit`
   - `ratelimit-remaining`
   - `ratelimit-reset` (seconds)
   - `ratelimit-policy` (Stripe, GitHub variants)
2. Когда remaining < threshold (e.g. 5) — паузить до reset.
3. `--rate-limit auto`: без cap'а CLI, throttle определяется headers.
4. Reporter: лог 'rate-limit headers seen, throttling at N req/s'.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Runner парсит ratelimit-limit, ratelimit-remaining, ratelimit-reset (RFC draft-ietf-httpapi-ratelimit-headers)
- [ ] #2 Авто-throttle: при remaining<5 паузить до reset
- [ ] #3 --rate-limit auto — стартует без limit, читает headers, подстраивается
- [ ] #4 Документация
<!-- AC:END -->
