---
id: ARV-191
title: >-
  stateful checks: respect requestBodyContentType (form-urlencoded for
  Stripe-style APIs)
status: Done
assignee: []
created_date: '2026-05-13 15:01'
updated_date: '2026-05-13 15:14'
labels:
  - m-20
  - depth
  - checks
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Stateful CRUD checks (cross_call_references ARV-169, idempotency_replay ARV-170, use_after_free, ensure_resource_availability) сериализуют request body как JSON.stringify(...), даже когда create.requestBodyContentType === 'application/x-www-form-urlencoded'. На Stripe-style API (form-encoded по всему spec'у) сервер игнорирует JSON-body → '400 Missing required param X' → broken-baseline guard скипает реальную проверку.

Прецедент: ARV-149/150 уже починили mass-assignment probe через core/runner/form-encode.ts (encodeFormBody). Тот же fix нужно применить в stateful checks.

Repro (после ARV-170 yaml-патчей на ~/Projects/zond-test/apis/stripe/.api-resources.local.yaml):
  zond checks run --api stripe --check idempotency_replay
  → 9 broken-baseline 400 на coupons/products/plans/invoiceitems/... Stripe говорит 'Missing required param: name' хотя generator выставил name в body.

Confirmed: products schema requires=['name'], no oneOf — generator корректно генерит {name}. Stripe не парсит JSON-body на form-encoded endpoint'ах.

Affected files:
- src/core/checks/checks/cross_call_references.ts:80 (JSON.stringify(writeBody))
- src/core/checks/checks/idempotency_replay.ts:~140 (JSON.stringify(writeBody))
- src/core/checks/checks/use_after_free.ts:31 (JSON.stringify(generateFromSchema(...)))
- src/core/checks/checks/ensure_resource_availability.ts (если есть POST step)

Acceptance:
- #1 helper в _crud-helpers.ts: serializeBody(body, contentType) → string, выбирает encodeFormBody vs JSON.stringify
- #2 cross_call_references, idempotency_replay, use_after_free используют helper
- #3 regression: повторный прогон idempotency_replay --api stripe → 9 broken-baseline 400 превращаются в real PASS/FAIL (или 422 если другая валидация-проблема, но не 'missing required name')
- #4 unit test: helper для application/x-www-form-urlencoded возвращает 'name=Foo&active=true', не '{...}'

Source: m-20 ARV-170 acceptance run (этот тред, 2026-05-13).
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Implementation notes (2026-05-13)

Both halves of the JSON-only bug were inlined into one helper:

- **Form-encoding** — `serializeCheckBody` dispatches on `create.requestBodyContentType`, calling `encodeFormBody` (ARV-149) for `application/x-www-form-urlencoded` so Stripe-style APIs accept the payload.
- **Placeholder substitution** — `generateFromSchema` returns literal markers (`{{$randomString}}`, `{{$randomInt}}`); helper now passes the body through `substituteDeep` before serialising. Probe-harness (ARV-150) does the same — stateful checks were the lone gap.

Stripe retest revealed a **fake-PASS** on customers pre-fix: Stripe was silently dropping the JSON payload on a form endpoint, so any two replays returned the same (effectively empty) response. After the fix the body lands for real, Stripe validates `expand[]` / typed scalars, and customers honestly broken-baselines on 400. Probe stopped lying.

Follow-up for real Stripe PASS coverage: generator tuning so random scalars satisfy provider validation (touches ARV-135 territory: deep oneOf/discriminator, plus broader 'don't generate expand[]' rules). Not in ARV-191 scope.

Affected files (consolidated under one helper):
- src/core/checks/checks/_crud-helpers.ts (helper + substituteDeep)
- src/core/checks/checks/cross_call_references.ts
- src/core/checks/checks/idempotency_replay.ts
- src/core/checks/checks/use_after_free.ts
- src/core/checks/checks/ensure_resource_availability.ts
- tests/core/checks/crud-helpers.test.ts (8 unit tests)
<!-- SECTION:NOTES:END -->
