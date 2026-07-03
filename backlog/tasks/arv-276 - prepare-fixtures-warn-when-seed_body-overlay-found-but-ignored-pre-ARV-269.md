---
id: ARV-276
title: 'prepare-fixtures: warn when seed_body overlay found but ignored (pre-ARV-269)'
status: To Do
assignee: []
created_date: '2026-05-17 13:29'
updated_date: '2026-05-18 13:02'
labels:
  - ux
  - prepare-fixtures
  - overlay
  - defer-post-m-23
dependencies:
  - ARV-269
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Контекст

ARV-269 закроет wiring: `prepare-fixtures --seed` будет читать `seed_body` overlay. Но до того patch'а — overlay тихо игнорируется в `prepare-fixtures`.

Юзер добавляет seed_body в `.api-resources.local.yaml`, ожидает что `--seed` его использует, и не понимает почему всё равно 400.

## Pre-ARV-269 mitigation

Если в `.api-resources.local.yaml` есть `seed_body:` для resource'ов, которые UNSET, и `prepare-fixtures --seed` запущен — emit warning:

```
⚠ Found seed_body overlay for N resources (customers, shipping_rates, ...),
  but `prepare-fixtures --seed` currently ignores it (see ARV-269).
  Overlay IS used by `zond checks run --check stateful`.
```

После ARV-269 — этот warning заменяется на confirmation: `Using seed_body overlay for N resources from .api-resources.local.yaml`.

## Refs

- ARV-269 (parent fix)
- Phase-2 report UX5
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Warning emit если в overlay есть seed_body, а prepare-fixtures его не использует
- [ ] #2 После ARV-269 message меняется на 'Using seed_body overlay for N resources'
<!-- AC:END -->
