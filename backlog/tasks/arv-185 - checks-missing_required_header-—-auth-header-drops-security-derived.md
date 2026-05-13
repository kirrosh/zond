---
id: ARV-185
title: 'checks: missing_required_header — auth-header drops (security-derived)'
status: Done
assignee: []
created_date: '2026-05-13 09:17'
updated_date: '2026-05-13 11:34'
labels:
  - m-18
  - parity-gap
  - deferred
dependencies: []
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Цель

Закрыть schemathesis-only gap по `missing_required_header` за счёт
security-derived headers (Stripe: 42 endpoints в overlap'е, все —
drop `Authorization`).

## Контекст

Schemathesis V4 при coverage-фазе генерирует MISSING_PARAMETER сценарий
не только для declared `parameters` с `in: header, required: true`, но
и для **security-derived** auth headers (`Authorization` для Bearer/Basic,
custom name для apiKey). На Stripe это даёт 42 finding'а — все вида
«Got 200/403 when missing required Authorization header, expected 401».

ARV-184 закрыл parity по spec-declared required headers, но на Stripe
их 0 → ARV-184 эффекта не дал.

## Проблема

Расширение `missing_required_header.applies` + `buildMissingHeader` на
security-derived headers даст дублирование с `ignored_auth`:

- `ignored_auth` (stateful, ARV-181): отправляет baseline + no_auth + bogus_auth.
- `missing_required_header` (per-response, ARV-184-extended): отправит
  no_auth-эквивалентный запрос ещё раз.

= +N лишних HTTP запросов (где N = ops с security).

## Опции фикса

### A. Reuse: не отправлять новый запрос, переиспользовать no_auth-результат от ignored_auth
Чистая архитектура, но требует cross-check state-sharing — large refactor.

### B. Дублировать: добавить auth-header drop в buildMissingHeader
Простой, +534 req на Stripe, +N на других API'ях. Schemathesis тоже
дублирует (у них тоже два check'а на одной случае).

### C. Skip on security: оставить как есть
Argument: ignored_auth уже покрывает auth-bypass через differential
+ strict-401. missing_required_header parity-gap — артефакт разного
определения "required header", не product issue.

## Рекомендация

**C** — текущее покрытие через ignored_auth (особенно после ARV-181
с differential + strict-401) ловит тот же класс багов. parity-gap
по check-имени структурный. Но если будет solid use case (например
schemathesis-style SARIF report'ы где категории должны совпадать) —
сделать B.

## Зависимости

- ARV-181 — ignored_auth должен уже работать.
- ARV-184 — spec-required headers exhaustive enumeration.

## Решение

Не делать в m-18. Если возникнет need — открыть и обсудить B vs C.
Закрыть после m-18 финализации.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 решение B (дублировать) или C (skip) принято с количественным обоснованием
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Won't-do (вариант C). Текущее покрытие через ignored_auth (после ARV-181 с differential + strict-401) ловит тот же класс auth-bypass багов. Parity-gap по check-имени структурный (schemathesis считает security-derived Authorization за required header; у zond это домен ignored_auth). Дублирование запроса нежелательно. Решение задокументировано в backlog/notes/m-18-decision.md §c'2.
<!-- SECTION:FINAL_SUMMARY:END -->
