---
id: ARV-146
title: >-
  decycleSchema sentinel utekает в parser: zond check spec пробует открыть
  apis/<api>/[Circular]
status: Done
assignee: []
created_date: '2026-05-12 08:49'
updated_date: '2026-05-12 08:52'
labels:
  - bug
  - regression
  - decycle
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Регрессия ARV-145

После фикса ARV-145 (decycleSchema перед JSON.stringify в writeArtifactsFromDoc) downstream-команды стали падать на чтении spec.json:

```
zond check spec apis/stripe/spec.json
→ ENOENT: apis/stripe/[Circular]
```

Причина: decycleSchema подставляла `{ "\$ref": "[Circular]" }` как cycle-sentinel. Когда decycled spec уходил на диск и потом перечитывался через `@readme/openapi-parser.dereference()` (в check spec / describe / generate / probe-*), парсер видел `\$ref` и пробовал резолвить строку `"[Circular]"` как JSON-pointer / file path → `apis/<api>/[Circular]`.

## Fix

Заменён sentinel на vendor-extension `{ "x-circular": true }`. `x-*` ключи в OpenAPI 3.x — зарезервированная territory для вендорных расширений, парсеры пропускают их verbatim без попытки резолва.

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 decycleSchema возвращает `{ "x-circular": true }` вместо `{ \"\$ref\": \"[Circular]\" }`.
- [x] #2 `zond check spec apis/stripe/spec.json` отрабатывает на decycled spec без ENOENT.
- [x] #3 Существующие callsite'ы decycleSchema (catalog.ts, describe.ts) не ломаются — они никогда не проверяли литерал.
- [x] #4 Тесты schema-utils обновлены под новый sentinel.
<!-- SECTION:DESCRIPTION:END -->

<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Confirmed by feedback-loop round 01 (Stripe API, 534 endpoints): tester saw spec.json with 3902 occurrences of "[Circular]" string causing ENOENT on apis/stripe/[Circular] across check spec/refresh-api/generate/checks run. After ARV-146 fix (x-circular vendor-extension sentinel): all 4 commands return ok=true. Tester recommendation matched our fix verbatim (sentinel object instead of string).
<!-- SECTION:NOTES:END -->
