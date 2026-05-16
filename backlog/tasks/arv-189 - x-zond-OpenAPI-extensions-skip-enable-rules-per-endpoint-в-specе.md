---
id: ARV-189
title: 'x-zond-* OpenAPI extensions: skip/enable rules per endpoint в spec''е'
status: Done
assignee: []
created_date: '2026-05-13 12:06'
updated_date: '2026-05-16 09:45'
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

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented x-zond-* OpenAPI vendor-extension policy (m-21, MVP scope).

Done (AC1, AC2, AC5):
- EndpointInfo.extensions field populated from operation + path-item x-* keys; operation wins on collision (openapi-reader.ts collectExtensions).
- New module src/core/checks/zond-extensions.ts: endpointSkipsCheck / reasonForSkip pure policy. Honors:
  - x-zond-skip: string | string[]  — direct check-id suppression
  - x-zond-public: true             — expands to AUTH_CHECK_IDS (ignored_auth, missing_required_header)
  Both can combine; either trigger fires a skip. Malformed values ignored without throwing.
- Wired into all three runner gates (runner.ts):
  - per-response phase: skip fires after applies() but BEFORE applicability counting so the universe reflects what would have run
  - stateful auth phase: filters the worker-pool input list; surfaces skipped op count in skipped_outcomes
  - stateful CRUD phase: skips the whole chain when create > list > read declares the skip (canonical resource-root convention)
- skipped_outcomes records 'check_id: x-zond-skip listed "id" at the spec level' or 'check_id: x-zond-public: true (auth check suppressed…)' so spec-level vs runtime skips are visually distinct in --report.
- zond-checks.md skill: new 'In-spec x-zond-* extensions' section with table, yaml example, priority order, and explicit AC3 deferral note.

NOT in this MVP (deferred; AC3 explicitly tracked in skill text):
- x-zond-resource / x-zond-idempotent / x-zond-lifecycle-field — need deeper m-20 overlay wiring to feed the resource-config maps directly. Task is narrow + universal: skip rules ship now, opt-in resource config a follow-up.

Tests: 12 unit (zond-extensions.test.ts) — pure policy + extraction from spec including operation > path-item precedence + no-churn empty-extensions undefined. 2 integration (zond-extensions-integration.test.ts) — end-to-end via runChecks: x-zond-skip on /health suppresses status_code_conformance; x-zond-public on /health suppresses ignored_auth while /private still runs the check normally. 2255/2255 unit suite green; tsc clean.
<!-- SECTION:NOTES:END -->
