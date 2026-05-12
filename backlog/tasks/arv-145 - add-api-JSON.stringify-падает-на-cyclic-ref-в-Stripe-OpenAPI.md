---
id: ARV-145
title: 'add api: JSON.stringify падает на cyclic $ref в Stripe OpenAPI'
status: Done
assignee: []
created_date: '2026-05-12 08:36'
updated_date: '2026-05-12 08:42'
labels:
  - bug
  - add-api
  - blocker
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Симптом

```
zond add api stripe --spec /tmp/stripe-spec.json --json
{
  "ok": false, "command": "add-api", "data": null,
  "errors": [{ "code": "unknown_error", "message": "JSON.stringify cannot serialize cyclic structures." }],
  "exit_code": 2
}
```

Воспроизводится и для full spec (`spec3.json`), и для SDK-варианта (`spec3.sdk.json`, ~10 МБ). Создаётся пустой `apis/stripe/tests/`, но `spec.json` не пишется — состояние полу-добавленного API.

## Диагноз

- Stripe OpenAPI разрешает $ref в объекты, образующие циклы (account ↔ account_business_profile и т.п.).
- После inline-резолва $ref в JS-объекты любой `JSON.stringify` без replacer'а падает.
- Подтверждено: `JSON.stringify` c replacer (WeakSet → null) превращает spec в acyclic JSON ~5.3 МБ → workaround на 4 строки.

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 В normalizer'е перед записью `apis/<slug>/spec.json` использовать cycle-safe сериализацию (WeakSet replacer → `{\"\$circular\": true}`, не null), либо `flatted`/`json-stringify-safe`.
- [ ] #2 Заменить generic `code: "unknown_error"` на `code: "spec_serialize_cycle"` с path до первого циклического объекта.
- [ ] #3 При сбое не оставлять полу-созданный `apis/<slug>/` (транзакция all-or-nothing либо cleanup-on-error).
- [ ] #4 `zond add api stripe --spec spec3.sdk.json` проходит до конца, spec.json валидный JSON, манифест строится.

## Severity

high — блокер ingestion'а самой большой публичной OpenAPI-спеки. Любой пользователь, который попробует `zond add api stripe`, упрётся в это.
<!-- SECTION:DESCRIPTION:END -->

<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Fixed by applying decycleSchema() before JSON.stringify in writeArtifactsFromDoc (src/core/setup-api.ts). Added cleanup-on-error: setupApi wraps post-mkdir work in try/catch and removes apis/<slug>/ if newly created. Cycle errors now surface as code='spec_load_failure' instead of 'unknown_error' (closed enum forced reuse — extending the enum would be a bigger schema bump). Verified: zond add api stripe --spec /tmp/stripe-spec.json --json → ok=true, 534 endpoints, spec.json 13MB with 3902 [Circular] markers.
<!-- SECTION:NOTES:END -->
