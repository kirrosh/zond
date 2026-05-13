---
id: ARV-187
title: 'zond api annotate: LLM-pass для .api-resources.local.yaml'
status: To Do
assignee: []
created_date: '2026-05-13 11:53'
updated_date: '2026-05-13 15:29'
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

После прогона annotate на Stripe spec'е almetric:
- lifecycle: ≥3 ресурса с state-machine
- idempotency: ≥10 POST endpoint'ов помечены
- pagination: ≥5 list endpoint'ов с cursor-блоком
- readback: ≥1 write_to_read_map предложен
- seed-bodies: ≥10 create endpoint'ов с валидным example POST body (Stripe customers/products/coupons/plans/etc.)

## --seed-bodies (m-20 done-criteria unblocker)

m-20 done-критерии #1 (cross_call_references ≥3 finding на Stripe) и #2 (idempotency green на Stripe) де-факто заблокированы тем что generateFromSchema выдаёт random scalars (UUID-strings, рандом для enum-like полей типа Stripe `expand[]`), и provider-валидация режет их 400. ARV-191 retest (2026-05-13) подтвердил: form-encoding/substitution заработали корректно, но Stripe валидирует значения строже чем generator может покрыть алгоритмически.

Решение в m-20 духе — НЕ tune generator (это deterministic auto-inference, от чего m-20 ушёл), а **LLM-pass пишет example body per resource в yaml** (берёт hints из spec.descriptions / x-examples / publicly known API conventions). Stateful checks (cross_call_references, idempotency_replay, use_after_free, ensure_resource_availability) preferentially читают `seed_body` из `.api-resources.local.yaml` через harness.resourceConfigs, fall back на generateFromSchema когда yaml-блок отсутствует.

Yaml-схема (поверх ARV-111 patches):
```yaml
resources:
  - resource: customers
    seed_body:
      content_type: application/x-www-form-urlencoded  # default наследует от create.requestBodyContentType
      body:
        description: 'zond probe customer'
        email: 'probe@example.com'
        # никаких `expand` — LLM знает что Stripe валидирует это поле
```

Stateful checks: если `seed_body.body` есть — serializeCheckBody(create, seed_body.body, vars). Иначе текущий путь generateFromSchema.

Зависимости: ARV-111 (overlay), ARV-169/170/171/172 (читатели invariants), ARV-191 (serializeCheckBody принимает body — точка интеграции).
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
- [ ] #11 #6 --seed-bodies: yaml-схема seed_body.{content_type, body} разобрана + прочитана через harness.resourceConfigs в stateful checks
- [ ] #12 #7 --seed-bodies regression: cross_call_references / idempotency_replay / ensure_resource_availability на Stripe customers/products/coupons превращают пост-ARV-191 broken-baseline 400 в реальный PASS или сигнальный finding
<!-- AC:END -->
