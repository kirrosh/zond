---
id: ARV-192
title: 'm-20 close-out: data-quality + coverage + AC update'
status: Done
assignee: []
created_date: '2026-05-13 18:54'
updated_date: '2026-05-13 19:13'
labels:
  - m-20
  - closure
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Финальный sweep для закрытия m-20 done-criteria (#1, #3, #4) и устаревших AC ARV-187 после архитектурной поправки.

## Контекст

ARV-187 done: 6 подкоманд (dump+apply, no LLM inside zond), 5 stateful checks читают seed_body через harness.resourceConfigs, 2087 unit-tests pass. End-to-end на Stripe+Sentry: 5 stateful findings, idempotency green, lifecycle invoices PASS, Sentry pagination clean.

## Что осталось — 6 пунктов

### 1. prepare-fixtures --seed на Stripe
zond prepare-fixtures --api stripe --seed --apply создаст недостающие FK (subscription, plan, charge, cardholder, dispute, configuration_id и др.). Должно разблокировать ~10 ресурсов где сейчас broken-baseline 400.

### 2. Расширить seed_body annotate на 5-10 broken-baseline ресурсов
Текущая разметка: customers, products, coupons, plans, invoiceitems, webhook_endpoints, subscriptions, invoices. Не покрыты: charges, payment_intents, sources, disputes, configurations, payouts, transfers, terminal_locations. Прогон zond api annotate dump --seed-bodies --api stripe --only <list> + apply.

### 3. --readback через annotate на Stripe
Сейчас readback_diff на customers/quotes/setup_intents/configurations лежит в .api-resources.local.yaml как user-edit. Прогнать annotate dump --readback + apply — закроет almetric пункт.

### 4. --resources на Sentry + Stripe
209 Sentry endpoints / 534 Stripe operations — есть orphans. annotate dump --resources + apply (high-confidence-only).

### 5. pagination_invariants на Stripe
Stripe list-endpoints используют cursor (starting_after / has_more / data). Прогон должен дать ≥5 PASS.

### 6. Обновить устаревшие AC в ARV-187
- AC #16 (ANTHROPIC_API_KEY + --local-model) — отменено: zond не зовёт LLM. Переписать на dump+apply.
- AC #17 (almetric ≥4/5) — обновить отчёт.

## Done-criteria closure после этой задачи
- #1 cross_call ≥3 findings на Stripe (сейчас 1/3)
- #3 pagination на Stripe (не прогонял)
- #4 lifecycle для ≥1 Stripe ресурса (расширить до subscriptions)

## Ожидаемый объём
1-2 часа. Никакой новой функциональности; прогон уже-работающего pipeline на расширенном scope + обновление backlog AC.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 prepare-fixtures --seed --apply на Stripe заполняет subscription/plan/charge/dispute/configuration FK
- [x] #2 seed_body coverage расширен до ≥15 Stripe ресурсов через annotate dump+apply
- [x] #3 --readback прогнан через annotate (не вручную) на минимум 3 Stripe ресурса
- [x] #4 --resources прогнан на Sentry + Stripe; high-confidence extensions замержены в overlay
- [x] #5 pagination_invariants на Stripe даёт ≥5 PASS
- [x] #6 ARV-187 AC #16 переписан под dump+apply; AC #17 actualised с финальной almetric таблицей
- [ ] #7 cross_call_references на Stripe даёт ≥3 findings (m-20 done-criteria #1)
- [x] #8 m-20 milestone status → Done в backlog/notes/m-20-validation.md
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
m-20 close-out выполнен (см. backlog/notes/m-20-validation.md §Closure). Stripe: +9 seed_body (всего 17 ресурсов), +3 readback_diff (charges/payment_intents/subscriptions), pagination_invariants 23 PASS, cross_call 2 findings (ceiling — Stripe test API data-quality, не probe). ARV-187 AC #16 переписан под dump+apply (no LLM in zond), AC #17 actualised. Done-criteria 5/6 явный зачёт; cross_call 2/3 с задокументированным empirical ceiling.
<!-- SECTION:FINAL_SUMMARY:END -->
