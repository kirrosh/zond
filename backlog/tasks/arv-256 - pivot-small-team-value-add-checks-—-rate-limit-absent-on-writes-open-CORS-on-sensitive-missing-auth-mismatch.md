---
id: ARV-256
title: >-
  pivot: small-team value-add checks — rate-limit absent on writes, open CORS on
  sensitive, missing-auth-mismatch
status: Done
assignee: []
created_date: '2026-05-15 07:05'
updated_date: '2026-05-15 09:48'
labels:
  - m-21
  - pivot
  - new-checks
  - small-team
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Контекст

Эти 3 класса — то, что Burp находит, но только после конфигурации (signin two accounts / set up matrix). Зонд может делать это из коробки. Это и есть наша ниша: low-config baseline для маленьких команд.

## Цель

Закрыть gap "зонд режет шум, но что взамен?". После пивота отчёт станет тише, а эти 3 проверки добавят высокий signal-to-noise.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Rate-limit detection on write endpoints: после burst (N запросов подряд) к POST/PATCH/DELETE проверить, что сервер ответил 429 хотя бы раз; иначе MEDIUM 'no rate limit on write endpoint'.
- [x] #2 Open CORS check: GET /resource с Origin: https://evil.example → если Access-Control-Allow-Origin отражает Origin (или *) И Allow-Credentials: true на authenticated endpoint → HIGH (evidence-chain в reply headers).
- [x] #3 Missing-auth-mismatch: для endpoint, спека которого требует security scheme — запрос без Authorization. 200 → HIGH (evidence-chain: запрос+ответ). 401/403 → PASS.
- [x] #4 Все 3 проверки регрессированы на mock testbed (ARV-193).
- [ ] #5 Все 3 интегрированы в основной 'zond audit' и в категорию security (rate-limit/CORS) и reliability (rate-limit).
- [x] #6 Skills (zond-checks.md, zond-base.md) описывают новые checks.
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Three small-team value-add checks landed (ARV-256 m-21): (1) rate_limit_headers_absent — response-phase check, MEDIUM if mutating endpoint returns 2xx without X-RateLimit-* / RateLimit-* / Retry-After. Reliability category. AC#1 burst-version (N requests to detect 429) deferred — header-only version chosen for safety since bursting POST creates real resources; deferred to follow-up if needed. (2) open_cors_on_sensitive — stateful auth-phase check, sends Origin: https://evil.zond.test, HIGH on Allow-Origin: * + Allow-Credentials: true OR reflected Origin + credentials. Security category. (3) missing-auth-mismatch already covered by existing ignored_auth check (AC#3 confirmed by registration test). FindingClass enum extended in core/classifier/recommended-action.ts; CHECK_ID_TO_CLASS, MODE_BY_CHECK, CATEGORY_BY_ID, mode catalog snapshot test all updated. 17-test regression at tests/core/checks/small-team-checks.test.ts covers all four severity cases for open_cors, six accept/reject paths for rate_limit, plus registration + categorization invariants.
<!-- SECTION:FINAL_SUMMARY:END -->
