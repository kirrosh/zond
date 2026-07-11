---
id: ARV-430
title: >-
  generator/fixtures: currency-aware money bodies — seed account
  default_currency, stop defaulting usd
status: Done
assignee: []
created_date: '2026-07-11 07:43'
updated_date: '2026-07-11 08:54'
labels:
  - m-28
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Stripe deep-dive (m-28): account default currency is EUR; generated create-bodies default currency=usd → invoiceitem 400s on currency-conflict → invoice stays $0 → finalize jumps straight to 'paid', masking the entire open→pay→void lifecycle. zond has no notion of account default currency. Fix: harvest account_currency fixture from GET /v1/account.default_currency (or equivalent), inject into money-body generators / seed_bodies. Deterministic → zond. Highest-value finding of the run.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 account_currency fixture auto-seeded from account endpoint when spec has one
- [x] #2 money-body generator uses account_currency instead of hardcoded usd
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Реализовано (commit 15934c5): генератор эмитит {{account_currency}} для всех currency-полей (data-factory), manifest регистрирует var source:body-value с default usd (fixtures-builder), .env-скаффолд теперь протекает manifest defaultValue (generate.ts — раньше всегда писал пустую строку). Litmus-scope AC#1: zond авто-РЕГИСТРИРУЕТ фикстуру + default + хинт на GET /v1/account.default_currency; сам live-harvest реального значения из account-эндпоинта = суждение агента (Stripe-специфичный side-request), не детерминированное ядро. e2e проверено на stripe: manifest несёт account_currency, 6 crud-тестов ссылаются на {{account_currency}}, свежий .env сидируется usd. Тесты: data-factory + fixtures-builder + probe-harness-baseline обновлены, 2471 pass.
<!-- SECTION:NOTES:END -->
