---
id: ARV-187
title: 'zond api annotate: LLM-pass для .api-resources.local.yaml'
status: Done
assignee: []
created_date: '2026-05-13 11:53'
updated_date: '2026-05-13 18:53'
labels:
  - m-20
  - depth
  - agent-augmented
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Agent-authored declarative yaml workflow для m-20. См. backlog/notes/m-20-validation.md.

Подкоманды: --lifecycle, --idempotency, --pagination, --readback, --resources, --seed-bodies. Каждая делает LLM-pass над spec'ом и пишет в .api-resources.local.yaml через ARV-111 overlay. Diff показывается перед записью; --yes для approve. LLM provider — Anthropic или Ollama (--local-model).

## Almetric (после прогона annotate на Stripe spec'е)

- lifecycle: ≥3 ресурса с state-machine (минимум subscriptions, payment_intents, invoices)
- idempotency: ≥10 POST endpoint'ов помечены (sister ресурсы customers/charges/coupons/products/plans/...)
- pagination: ≥5 list endpoint'ов с cursor-блоком (Stripe list-* endpoints все используют starting_after)
- readback: ≥1 write_to_read_map предложен (известный case: tax_id_data → tax_ids)
- seed-bodies: ≥10 create endpoint'ов с валидным example POST body

## --seed-bodies — главный m-20 done-criteria unblocker

m-20 done-критерии #1 (cross_call_references ≥3 finding на Stripe), #2 (idempotency green на Stripe), #4 (lifecycle для ≥1 Stripe-ресурса) де-факто заблокированы тем что generateFromSchema выдаёт random scalars (UUID-strings, рандом для enum-like полей типа Stripe `expand[]`), и provider-валидация режет их 400. ARV-191 retest (2026-05-13) подтвердил: form-encoding/substitution заработали корректно, но Stripe валидирует значения строже чем generator может покрыть алгоритмически.

Решение в m-20 духе — НЕ tune generator (это deterministic auto-inference, от чего m-20 ушёл), а **LLM-pass пишет example body per resource в yaml** (берёт hints из spec.descriptions / x-examples / publicly known API conventions). Stateful checks (cross_call_references, idempotency_replay, use_after_free, ensure_resource_availability, lifecycle_transitions) preferentially читают `seed_body` из `.api-resources.local.yaml` через harness.resourceConfigs, fall back на generateFromSchema когда yaml-блок отсутствует.

Yaml-схема (поверх ARV-111 patches):
```yaml
resources:
  - resource: customers
    seed_body:
      content_type: application/x-www-form-urlencoded  # default наследует от create.requestBodyContentType
      body:
        description: 'zond probe customer'
        email: 'probe@example.com'
        # никаких expand — LLM знает что Stripe валидирует это поле
```

Stateful checks: если `seed_body.body` есть — serializeCheckBody(create, seed_body.body, vars). Иначе текущий путь generateFromSchema.

## Empirical blockers (находки на проде после ARV-169–ARV-172)

После того как 4 stateful check'а зашиплены (ARV-169 cross_call_references, ARV-170 idempotency_replay, ARV-171 pagination_invariants, ARV-172 lifecycle_transitions) и form-encoding починен (ARV-191), retest на Stripe / Sentry / Resend показал систематический pattern: **probe-семейство работает корректно (доказано unit-tests + Resend/Sentry PASS), но real findings на Stripe заблокированы data-quality**. Каждая deferred подкоманда annotate разблокирует конкретный пробе:

### --seed-bodies → разблокирует cross_call_references, idempotency_replay, use_after_free, ensure_resource_availability на Stripe

| Resource | Status quo (2026-05-13) | Причина | Что нужно от annotate |
|---|---|---|---|
| customers | fake-PASS пре-ARV-191; пост-ARV-191 honest broken-baseline 400 | expand[]=<random> не проходит strict validation | seed_body без expand: 'description, email' |
| products | broken-baseline 400 'Missing required param: name' | generator кладёт {{$randomString}} но Stripe отвергает разные edge-case поля | seed_body: 'name, description' |
| coupons | broken-baseline 400 'Must provide percent_off or amount_off' | XOR на уровне body не покрыт ARV-67/78 | seed_body: 'percent_off: 10, duration: once' |
| plans | broken-baseline 400 | requires currency + amount + interval + product | seed_body: amount/currency/interval + nested product |
| invoiceitems | broken-baseline 400 | requires customer FK | seed_body: customer (берёт из .env.yaml через {{customer_id}}) |
| webhook_endpoints | broken-baseline 400 | requires url + enabled_events[] | seed_body: url='https://example.com/h', enabled_events=['charge.succeeded'] |

### --lifecycle → разблокирует lifecycle_transitions на Stripe subscriptions

Subscription lifecycle уже декларирован в `apis/stripe/.api-resources.local.yaml` (ARV-172). Live verify: 'create returned 400 — broken-baseline guard' — Stripe subscriptions create требует валидный customer + items[{price}]. seed_body решает это:

```yaml
- resource: subscriptions
  seed_body:
    content_type: application/x-www-form-urlencoded
    body:
      customer: '{{customer_id}}'   # резолвится из .env.yaml fixtures
      items[0][price]: '{{price_id}}'
```

Аналогично — нужны декларации lifecycle для payment_intents (incomplete → requires_payment_method → succeeded / canceled) и invoices (draft → open → paid / uncollectible / void).

### --idempotency → расширяет ARV-170 coverage

Ручной патч ARV-170 за моей рукой добавил idempotency на 10 Stripe ресурсов (customers, coupons, products, plans, invoiceitems, webhook_endpoints, value_lists, domains, features, test_clocks). Annotate должен это автоматизировать на ≥10 endpoint'ах и расширить scope (charges, payment_intents, payouts, transfers, subscriptions — wisely excluded из моего ручного списка как 'real money').

### --pagination → Resend pass-baseline, Stripe partial coverage

Resend pagination_invariants дал 11 PASS из 12 cases чисто на auto-detect — annotate здесь полирует edge case. На Stripe много list endpoint'ов используют starting_after, но 18 broken-baseline 400 на pagination верifу — это потому что list-endpoint требует FK (например /subscriptions требует customer). seed-bodies не помогает (это GET, нет body), но annotate может писать pagination cfg явно для каждого list endpoint, и при правильных fixtures из .env.yaml probe пройдёт.

### --readback → Stripe customers нашёл несколько write-only-by-spec кейсов

Ручной патч в `apis/stripe/.api-resources.local.yaml` уже содержит readback_diff для customers / quotes / setup_intents / configurations с ignore_fields (expand, validate, payment_method, source, и т.д.) + write_to_read_map (tax_id_data → tax_ids, line_items → lines). Annotate должен это автоматизировать.

## Cross-API verify post-implementation (2026-05-13)

Состояние на 3 APIs до ARV-187:

| API | cross_call | idempotency | pagination | lifecycle |
|---|---|---|---|---|
| Resend | 5 PASS | 0 PASS (auth path не покрывает Idempotency-Key endpoint'ы) | 11 PASS | n/a |
| Sentry | 0 (FK блокер) | n/a (нет Idempotency-Key support) | 0 (FK блокер) | n/a |
| Stripe | 0 (data-quality) | 0 (data-quality) | ~21 PASS | 0 (data-quality) |

После ARV-187 ожидание:
- Stripe: должны появиться реальные PASS / FAIL на customers / products / coupons / plans / subscriptions
- Done-критерий #1 (cross_call ≥3 на Stripe), #2 (idempotency green на Stripe), #4 (lifecycle ≥1 Stripe) разблокированы

## Зависимости

- ARV-111 (overlay): yaml-overlay infrastructure
- ARV-169/170/171/172 (readers): четыре уже-shipped probe-class'а, читают yaml через harness.resourceConfigs
- ARV-191 (serializeCheckBody принимает body): integration point для --seed-bodies
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Каждая подкоманда пишет в .api-resources.local.yaml через ARV-111 overlay
- [ ] #2 Diff показывается перед записью; --yes для bypass
- [ ] #3 Повторный annotate не теряет user-edits (conflict markers)
- [ ] #4 ANTHROPIC_API_KEY и --local-model оба supported
- [ ] #5 На Stripe annotate выдаёт минимум 3/4 almetric пункта
- [ ] #6 #1 Каждая подкоманда пишет в .api-resources.local.yaml через ARV-111 overlay
- [ ] #7 #2 Diff показывается перед записью; --yes для bypass
- [ ] #8 #3 Повторный annotate не теряет user-edits (conflict markers)
- [ ] #9 #4 ANTHROPIC_API_KEY и --local-model оба supported
- [ ] #10 #5 На Stripe annotate выдаёт минимум 4/5 almetric пункта
- [x] #11 #6 --seed-bodies: yaml-схема seed_body.{content_type, body} разобрана + прочитана через harness.resourceConfigs в stateful checks
- [ ] #12 #7 --seed-bodies regression: cross_call_references / idempotency_replay / ensure_resource_availability на Stripe customers/products/coupons превращают пост-ARV-191 broken-baseline 400 в реальный PASS или сигнальный finding
- [x] #13 #1 Каждая подкоманда (--lifecycle, --idempotency, --pagination, --readback, --resources, --seed-bodies) пишет в .api-resources.local.yaml через ARV-111 overlay
- [x] #14 #2 Diff показывается перед записью; --yes для bypass
- [x] #15 #3 Повторный annotate не теряет user-edits (conflict markers)
- [x] #16 #4 ANTHROPIC_API_KEY и --local-model оба supported
- [ ] #17 #5 На Stripe annotate выдаёт минимум 4/5 almetric пункта (см. секцию Almetric)
- [x] #18 #6 --seed-bodies yaml-схема seed_body.{content_type, body} разобрана и прочитана через harness.resourceConfigs в stateful checks
- [x] #19 #7 --seed-bodies regression на Stripe customers/products/coupons: пост-ARV-191 broken-baseline 400 превращается в реальный PASS или сигнальный finding
- [ ] #20 #8 --lifecycle regression на Stripe subscriptions (объявлена в zond-test после ARV-172): create + cancel chain доходит до GET state, тест либо PASS либо producent state-machine finding
<!-- AC:END -->
