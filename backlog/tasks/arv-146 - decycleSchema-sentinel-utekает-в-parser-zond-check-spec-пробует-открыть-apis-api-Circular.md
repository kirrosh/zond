---
id: ARV-146
title: >-
  decycleSchema sentinel utekает в parser: zond check spec пробует открыть
  apis/<api>/[Circular]
status: Done
assignee: []
created_date: '2026-05-12 08:49'
updated_date: '2026-05-12 08:49'
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
Fix landed in same commit chain as ARV-145 follow-up. Sentinel changed in src/core/generator/schema-utils.ts; comment updated in src/core/setup-api.ts; tests updated in tests/core/generator/schema-utils.test.ts. Verified: zond check spec apis/stripe/spec.json → ok=true, 788 issues, 460 endpoints, no ENOENT.
<!-- SECTION:NOTES:END -->
