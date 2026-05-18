---
id: ARV-271
title: 'annotate-auto: resolve $ref для Idempotency-Key в parameters'
status: Done
assignee: []
created_date: '2026-05-17 13:27'
updated_date: '2026-05-18 11:43'
labels:
  - annotate
  - annotate-auto
  - idempotency
  - arv-262-followup
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Контекст

`zond api annotate auto --aspect all --confidence high --auto-apply` сейчас матчит `Idempotency-Key` parameter по inline name. Если spec декларирует header как `$ref: '#/components/headers/Idempotency-Key'` (как делает Stripe), то heuristic его не видит — 0 idempotency inferences.

## Evidence (Stripe, 2026-05-17)

Stripe spec: Idempotency-Key объявлен один раз в `components/headers/Idempotency-Key` и используется через `$ref` на каждой POST/DELETE operation.

```
zond api annotate auto --aspect all --confidence high --auto-apply
→ "Scanned 108 resource(s); produced 96 high-confidence inference(s).  pagination: 96"
→ (0 idempotency inferences)

zond checks run --check stateful → idempotency_replay: 77/77 skipped
  "no idempotency config and no Idempotency-Key parameter in spec"
```

Stripe **поддерживает** Idempotency-Key. Просто heuristic не дошёл до `$ref`.

## Fix

В `src/cli/commands/api/annotate/auto.ts` (idempotency-block) — резолвить `$ref` для `parameters[*]` перед string-match по name. Pattern уже есть в OpenAPI parser'е, переиспользовать.

## Refs

- ARV-262 (annotate auto framework)
- Phase-1 report: ~/Projects/zond-scans/reports/stripe/20260517-150957-live/report-zond.md (MF2)
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 annotate auto разрешает $ref для parameters[*] перед матчингом name
- [x] #2 На Stripe spec idempotency inference появляется для всех POST с $ref на Idempotency-Key
- [x] #3 Unit test покрывает minimal $ref fixture
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Resolved $ref в parameters[*] перед матчингом name (src/cli/commands/api/annotate/prompts.ts: resolveParameter). Поддерживает оба варианта: components.parameters/X (канон) и components.headers/X (Stripe). Тесты: tests/cli/annotate-prompts.test.ts (3 кейса).
<!-- SECTION:NOTES:END -->
