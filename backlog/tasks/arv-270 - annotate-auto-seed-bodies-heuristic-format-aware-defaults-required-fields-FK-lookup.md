---
id: ARV-270
title: >-
  annotate-auto seed-bodies heuristic (format-aware defaults + required-fields +
  FK lookup)
status: Done
assignee:
  - '@claude'
created_date: '2026-05-17 13:27'
updated_date: '2026-05-17 15:24'
labels:
  - annotate
  - annotate-auto
  - seed-body
  - arv-187-followup
  - arv-262-followup
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Контекст

ARV-187 (agent-loop seed-bodies pipeline: `dump` → агент-LLM думает → `apply`) shipped. Но **agent-loop = единственный source LLM в zond по контракту** (memory `feedback_zond_no_llm_calls.md` — zond не зовёт LLM напрямую, только через агента-CLI), что значит:

- На каждый scan нужен LLM-доступ (Claude/Codex/etc) для overlay-генерации
- Per-resource токены — 108 resources × ~3-5K tokens = noticeable cost для крупного API
- Slow path: dump → LLM round-trip → apply → repeat

ARV-262 паттерн (heuristic auto без агента) closed pagination automatically — 96 inferences на Stripe одной командой, ноль токенов. Этот же паттерн **должен** покрыть seed-bodies для типичных RESTful resources.

## Эвристики (без LLM)

1. **Format-aware defaults** (из `format:` / heuristic name match):
   - `email` → `zond-probe@example.com`
   - `url`/`uri` → `https://example.com/zond-probe`
   - `currency` (3-char enum или name match) → `usd`
   - `country` (2-char enum) → `US`
   - `date-time` → `2025-01-01T00:00:00Z`
   - integer (default) → `100`; (name match `amount`/`unit_amount`) → `1000`
   - boolean → `false`
   - string (default) → `zond-probe-{{resource}}`

2. **Required-fields fill**: парсить `required: [...]` из request schema; заполнять каждое required по format-rule выше

3. **FK lookup из .env.yaml**: если required field имеет имя `customer`/`product`/`source`/`account`/`subscription` → подставить `{{customer}}` template из .env.yaml (там уже есть discovered FK'ы)

4. **Enum first-value**: если schema declares `enum: ["fixed_amount", "percentage"]` → взять первый

5. **content_type из spec**: посмотреть `requestBody.content` keys — взять предпочтительный (если есть application/json — JSON, иначе form-urlencoded; ARV-149/150 уже это умеют)

## Когда падать обратно к agent-loop

Heuristic производит inference только с `confidence high|medium`. Если для ресурса required fields имеют:
- complex nested schemas (object с required keys внутри)
- discriminator unions без single happy-path
- conditional XOR (один из двух required — coupons: `percent_off OR amount_off`)
- vendor-specific формат (Stripe-style `metadata[key]=val` bracket syntax)

→ не пытаемся, оставляем для `dump`/`apply` agent-loop (ARV-187).

## Evidence

Stripe live-scan (2026-05-17): добавил 10 manual seed-bodies → stateful checks от 0 → 583 findings (HIGH cross_call drift, MEDIUM eventual-consistency).

Если ARV-269 (overlay wiring) + ARV-270 (auto-gen) выкатать вместе:
- 60-80% Stripe write-heavy resources получают valid seed_body без LLM
- mass-assignment 290 INCONCLUSIVE → ~50 (только сложные resources падают в agent-loop)
- `prepare-fixtures --seed` filled rate с 29% (только discovery) → ~60% без агента

На GitHub/Linear/Notion (JSON, simpler schemas) heuristic покроет 80-90%.

## Цель

`zond api annotate auto --aspect seed-bodies --confidence high --auto-apply` пишет seed_body block в `.api-resources.local.yaml` для каждого ресурса с create endpoint и required fields, **без вызова агента**. Agent-loop остаётся доступен как `--aspect seed-bodies --use-agent` для оставшихся 20-40% сложных случаев.

## Acceptance Criteria
<!-- AC:BEGIN -->
- `auto --aspect seed-bodies --auto-apply` пишет seed_body в overlay для типичных resources (без LLM-вызова)
- Format-aware defaults покрывают email/url/currency/country/date-time/integer/boolean
- FK lookup substitutes `{{var}}` templates из .env.yaml
- На Stripe sandbox после `auto --aspect seed-bodies --auto-apply` + `prepare-fixtures --seed` — `customers`/`products`/`coupons`/`webhook_endpoints` создаются (POST 200, не 400)
- На GitHub/Linear sandbox: auto generates ≥80% required write-heavy resources
- Resources, не покрытые heuristic, остаются для agent-loop (ARV-187 dump+apply)
- Unit-test: minimal Stripe-like spec fixture → heuristic produces valid seed_body

## Refs

- ARV-262 (annotate-auto framework — pattern для нового aspect)
- ARV-187 (agent-loop seed-bodies pipeline) — Done; этот task делает её optional
- ARV-269 (seed_body wiring everywhere) — sibling, без него auto-gen не дойдёт до prepare-fixtures/probe
- memory: feedback_zond_no_llm_calls.md — zond сам не зовёт LLM
- Phase-1 report MF5: ~/Projects/zond-scans/reports/stripe/20260517-150957-live/report-zond.md
<!-- SECTION:DESCRIPTION:END -->

- [x] #1 annotate auto --aspect seed-bodies --auto-apply пишет seed_body в overlay
- [x] #2 format-aware defaults: email/url/currency/country/date-time/integer/boolean
- [x] #3 FK lookup: required field name matches .env.yaml var → template substitution
- [ ] #4 На Stripe sandbox создаёт customers/products/coupons/webhook_endpoints через --seed
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
ARV-270 implemented: seed-bodies aspect добавлен в zond api annotate auto.

Изменения:
- src/cli/commands/api/annotate/auto.ts: новый inferSeedBody(slice, env?) — heuristic POST body для resource.endpoints.create. Cascade: enum first-value -> FK env lookup ({{var}}, с stripping _id/_uuid/_slug) -> format-aware (email/uri/date-time/uuid) -> name-based (currency=usd, country=US, locale=en-US, amount=1000) -> generic fallback. high confidence когда все required заполнились через signal; medium когда хотя бы одно через generic fallback. Drops to null когда oneOf/anyOf union (discriminator XOR), nested required object, или required field unfabricable (object без required).
- src/cli/commands/api/annotate/index.ts: AUTO_ASPECTS += 'seed-bodies'; autoCommand загружает .env.yaml через loadEnvFile() и пробрасывает env в inferAll. CLI --aspect help обновлён.
- tests/cli/annotate-auto.test.ts: +12 кейсов: format-aware (email/url/date-time/uuid), name-based ISO (currency/country), enum first-wins, FK lookup exact name/stripped stem, placeholder env values not counted, generic fallback => medium, content_type из spec, nested-required => null, oneOf => null, no-create => null, no-required => null, object-no-required => null.

AC статус:
- AC #1 wire to overlay + AC #2 format-aware + AC #3 FK lookup — все покрыты unit-тестами; авто-режим autoCommand уже идёт через existing mergePatches+writeLocalOverlay путь (ARV-262 framework).
- AC #4 (Stripe sandbox: customers/products/coupons/webhook_endpoints через --seed) — требует live API key + sandbox tenant, не запускалось здесь. Готово к проверке пользователем: zond api annotate auto --api stripe --aspect seed-bodies --auto-apply && zond prepare-fixtures --api stripe --seed --apply. Sibling ARV-269 (overlay wiring до prepare-fixtures) уже shipped, поэтому overlay реально дойдёт до seed POST'ов.

Тесты: bun run check чисто, 29 unit-тестов в annotate-auto.test.ts pass. Регрессий нет — pre-existing flaky SSRF-rebalance остался без изменений.
<!-- SECTION:NOTES:END -->
