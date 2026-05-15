---
id: ARV-256
title: >-
  pivot: small-team value-add checks — rate-limit absent on writes, open CORS on
  sensitive, missing-auth-mismatch
status: To Do
assignee: []
created_date: '2026-05-15 07:05'
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
- [ ] #1 Rate-limit detection on write endpoints: после burst (N запросов подряд) к POST/PATCH/DELETE проверить, что сервер ответил 429 хотя бы раз; иначе MEDIUM 'no rate limit on write endpoint'.
- [ ] #2 Open CORS check: GET /resource с Origin: https://evil.example → если Access-Control-Allow-Origin отражает Origin (или *) И Allow-Credentials: true на authenticated endpoint → HIGH (evidence-chain в reply headers).
- [ ] #3 Missing-auth-mismatch: для endpoint, спека которого требует security scheme — запрос без Authorization. 200 → HIGH (evidence-chain: запрос+ответ). 401/403 → PASS.
- [ ] #4 Все 3 проверки регрессированы на mock testbed (ARV-193).
- [ ] #5 Все 3 интегрированы в основной 'zond audit' и в категорию security (rate-limit/CORS) и reliability (rate-limit).
- [ ] #6 Skills (zond-checks.md, zond-base.md) описывают новые checks.
<!-- AC:END -->
