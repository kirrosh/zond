---
id: ARV-282
title: 'ARV-282: cascade-aware FK staleness check'
status: Done
assignee: []
created_date: '2026-05-17 18:20'
labels:
  - prepare-fixtures
  - arv-277-followup
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Контекст

Самый ценный followup из dogfooding (ARV-277 session). Stripe-style stale FK pattern: env.yaml хранит `customer: cus_UVjelxcZmzbiUb` с прошлого скана, но Stripe sandbox его уже стёр. Cascade продолжает использовать stale id → 10+ downstream seed POSTs валятся с `resource_missing: customer` → агент тратит время на копание (а вылезает только при manual debug).

## Решение

`prepare-fixtures --check-staleness` — pre-cascade validation:
- Для каждой preFilled FK var: найти owner resource → GET к read endpoint с substituted path-param
- 404 → clear env[var], log "refresh: <var> <value> no longer exists", drop from preFilled set
- 200 → keep
- 401/403/5xx/network → keep (conservative, не тратить cascade budget на transient)

Один extra GET per preFilled FK в начале session. Окупается с первого catch.

## Acceptance Criteria

- Pre-filled var → owner.read → 404 → cleared + logged
- Pre-filled var → owner.read → 200 → kept silently
- Pre-filled var without owner read endpoint → "skip-no-read" (kept)
- Wire через prepare-fixtures CLI flag --check-staleness
- Stripe sanity-check: 9 stale fixtures detected and refreshed in single run

## Status

Done — commit (ARV-278/279/280/281/282 batch).
<!-- SECTION:DESCRIPTION:END -->
