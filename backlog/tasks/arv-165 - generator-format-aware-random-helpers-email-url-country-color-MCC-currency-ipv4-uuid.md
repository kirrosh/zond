---
id: ARV-165
title: >-
  generator: format-aware random helpers
  (email/url/country/color/MCC/currency/ipv4/uuid)
status: Done
assignee: []
created_date: '2026-05-12 12:46'
updated_date: '2026-05-12 13:11'
labels:
  - feedback-loop
  - api-stripe
  - m-16
  - generator
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Source: feedback round 09, R09 ceiling analysis.

Repro: zond generate --api stripe → POST endpoints получают {{$randomString}} для color/email/url/region/etc. После zond run видим 199 'hit but fail' steps на Stripe (37% pass) — Stripe валидирует format на ранней стадии (email, url, ISO country, MCC code, currency, ipv4, uuid v4).

Expected: cascade resolver знает по schema.format / schema.enum / по имени поля (${$randomEmail}, {{$randomUrl}}, {{$randomCountryCode}}, {{$randomCurrencyCode}}, {{$randomMCC}}, {{$randomIPv4}}, {{$randomUUID}}, {{$randomColorHex}}). Universal set (не Stripe-specific), но покрывает 80% format-rejected fields на mainstream APIs (Stripe/GitHub/Twilio/Shopify).

Acceptance:
- helper-table в docs (open list, легко расширяется)
- generator подбирает helper по format/enum/name (в этом порядке)
- pass-rate Stripe (R09 baseline) растёт с 37% → ≥50% без custom tuning

Effect: removes biggest 'out-of-scope' lever в R09 анализе. См. feedback-09.md §'Что нужно для >70% pass'.
<!-- SECTION:DESCRIPTION:END -->
