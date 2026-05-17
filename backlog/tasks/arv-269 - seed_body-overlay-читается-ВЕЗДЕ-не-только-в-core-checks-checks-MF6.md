---
id: ARV-269
title: 'seed_body overlay читается ВЕЗДЕ, не только в core/checks/checks/ (MF6)'
status: To Do
assignee: []
created_date: '2026-05-17 13:26'
updated_date: '2026-05-17 14:44'
labels:
  - annotate
  - prepare-fixtures
  - probe
  - arv-187-followup
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Контекст

ARV-187 (agent-loop overlay pipeline: `dump` → агент думает → `apply`) shipped и работает: overlay читается **только** stateful checks (`src/core/checks/checks/*.ts`). Не читается:

- `src/cli/commands/prepare-fixtures.ts` → `--seed` цикл ходит по spec-generator (`{{$randomString}}`)
- `src/core/probe/mass-assignment*.ts` → baseline-create body тоже из generator'а (хотя ARV-150 уже подключил form-urlencoded — body есть, но overlay не читается)
- `src/core/probe/security.ts` → same (ARV-161 done, но overlay для baseline не используется)

Это частично реализованная фича: agent-loop authored overlay молча игнорируется в `prepare-fixtures` и `probe`. Грязное состояние — Done-задачи ARV-150/161 не получают преимущества от Done-задачи ARV-187.

## Evidence (Stripe live-scan, 2026-05-17)

Добавил seed_body overlay для 10 ресурсов вручную (имитация agent-loop результата). Прямой тест работает:

```
zond request POST /v1/shipping_rates --api stripe --form --body '{"display_name":"zond","type":"fixed_amount","fixed_amount[amount]":500,"fixed_amount[currency]":"usd"}'
→ 200 OK
```

Но:
```
zond prepare-fixtures --apply --cascade --seed
→ POST /v1/shipping_rates → 400 (overlay не использован — pad из generator'а вместо overlay body)
→ POST /v1/customers → 400 (то же)
... 26 × 400, 0 successful seed POSTs
→ Filled 27/92 path-FK vars (29%) — все 27 от discovery, 0 от seed
```

И `probe mass-assignment` остался 290/290 INCONCLUSIVE — потому что baseline-create берёт generator'ный body, не overlay.

При этом **stateful checks с тем же overlay** дали 0 → **583 findings** (4 HIGH `cross_call_references`, 577 HIGH `open_cors_on_sensitive`, 2 MEDIUM eventual-consistency).

## Impact

ARV-187 (agent-loop) тратит токены на каждый ресурс, генерит overlay — но половина потребителей (prepare-fixtures + probe) её не читает. ROI agent-loop половинный.

Это **mechanical wiring** — алгоритм уже в `_crud-helpers.ts` (`resolveCreateBody()` или похожий), нужен перенос вызовов.

## Цель

seed_body overlay из `.api-resources.local.yaml` учитывается в:

1. `src/cli/commands/prepare-fixtures.ts` — seed-loop berёт overlay body вместо generator'а
2. `src/core/probe/mass-assignment*.ts` — baseline-create берёт overlay body
3. `src/core/probe/security.ts` — same
4. `src/core/probe/webhooks*.ts` — same (если применимо)

Все четыре уже имеют form-urlencoded поддержку (ARV-150/161 done), нужно только направить construction через overlay-aware path.

## Acceptance Criteria
<!-- AC:BEGIN -->
- `prepare-fixtures --seed` с overlay для `shipping_rates` создаёт ресурс (POST → 200/201)
- `probe mass-assignment` использует overlay body для baseline-create (verified: на Stripe sandbox 290 INCONCLUSIVE drops to <50)
- `probe security` использует overlay body
- Summary log упоминает "loaded seed_body for N resources from overlay"
- Test fixture: minimal overlay + spec → `prepare-fixtures --seed` ожидает overlay body в outbound request

## Refs

- ARV-187 (parent — agent-loop) — Done
- ARV-150 (mass-assignment form-encoded) — Done, но не получает overlay
- ARV-161 (security form-encoded) — Done, но не получает overlay
- Phase-2 report MF6: ~/Projects/zond-scans/reports/stripe/20260517-150957-live/report-zond.md
<!-- SECTION:DESCRIPTION:END -->

- [ ] #1 prepare-fixtures --seed читает seed_body из .api-resources.local.yaml
- [ ] #2 probe mass-assignment использует overlay body для baseline-create
- [ ] #3 probe security использует overlay body для baseline
- [ ] #4 summary log упоминает loaded seed_body for N resources
<!-- AC:END -->
<!-- AC:END -->
