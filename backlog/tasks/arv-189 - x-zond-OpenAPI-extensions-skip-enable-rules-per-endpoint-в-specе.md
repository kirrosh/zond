---
id: ARV-189
title: 'x-zond-* OpenAPI extensions: skip/enable rules per endpoint в spec''е'
status: To Do
assignee: []
created_date: '2026-05-13 12:06'
updated_date: '2026-05-13 19:20'
labels:
  - m-20
  - depth
  - dx
  - m-21
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Pattern скопирован из Dochia (--skip-playbooks-for-extension). См. backlog/notes/m-20-validation.md §«Dochia deep-dive».

## Цель

Позволить пользователю объявлять per-endpoint правила прямо в OpenAPI spec'е через extensions (`x-zond-*`), без отдельного config file. Complements .api-resources.yaml как low-friction fallback для одиночных операций.

## Поведение

OpenAPI extensions на operation-level (или path-level):

```yaml
paths:
  /v1/public/status:
    get:
      x-zond-skip: [ignored_auth, missing_required_header]
      x-zond-public: true  # shortcut для всех auth checks
      x-zond-rate-limit-bypass: true
```

Resource-level extensions:

```yaml
paths:
  /v1/subscriptions:
    x-zond-resource: subscription
    x-zond-idempotent: true
    x-zond-lifecycle-field: status
```

## Поведение probe-runner'а

- Перед запуском check'а — читать operation.extensions из normalized spec'а.
- `x-zond-skip: [<check>]` — skip-list для конкретного endpoint.
- `x-zond-public: true` — auto-skip auth-related checks (ignored_auth, missing_required_header в части Authorization).
- `x-zond-resource: <name>` + `x-zond-idempotent: true` — opt-in для m-20 probes без записи в .api-resources.yaml.
- Conflict с .api-resources.local.yaml — overlay побеждает (explicit > implicit).

## Зависимости

- ARV-187 (annotate) — annotate-pass пишет в .api-resources.local.yaml, но может также предлагать x-zond-* extensions как альтернативу через --output extensions.
- spec-loader должен сохранять extensions при parse (проверить, не отрезаются ли).

## Acceptance

- AC1: x-zond-skip на operation работает, check skipped с reason в --report
- AC2: x-zond-public shortcut работает для auth checks
- AC3: x-zond-resource + x-zond-idempotent видны m-20 probe'ами как opt-in
- AC4: priority resolution: .api-resources.local.yaml > x-zond-* extensions > .api-resources.yaml > defaults
- AC5: docs в zond.md / zond-checks.md skills
<!-- SECTION:DESCRIPTION:END -->
