---
id: ARV-183
title: >-
  checks: spec-lookup использует originalPath после ARV-40 disambiguation
  (phantom findings на Stripe)
status: To Do
assignee: []
created_date: '2026-05-13 08:29'
labels:
  - m-18
  - bug
  - checks
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Цель

Чинить phantom findings в `status_code_conformance` на API'ях с
ARV-40 path-disambiguation (Stripe главный пострадавший: 601 phantom
findings вместо реальных 0).

## Корневая причина

ARV-40 (`src/core/generator/path-param-disambig.ts`) переименовывает
generic `{id}` → `{external_account_id}` в `EndpointInfo.path` чтобы
fixture-manifest не сливал per-resource переменные. Комментарий явно
говорит: "All downstream code ... then sees per-resource var names
without any extra plumbing."

Но `status_code_conformance.declaredStatuses()` (status_code_conformance.ts:14)
ищет `doc.paths[c.operation.path]` буквально:

  const op = (doc.paths?.[path] as ...)?.[method.toLowerCase()];

Renamed path в `EndpointInfo` ≠ original path в `doc.paths` → `op = undefined`
→ `codes = empty`, `hasDefault = false` → ЛЮБОЙ status → fail.

На Stripe это даёт 601 phantom findings (404=338, 403=99, 400=60, 204=36,
405=36, 200=32). Real findings = 0.

## Аналогичный риск в других checks

Любая check которая делает `doc.paths[op.path]` lookup. Кандидаты:
- response_headers_conformance — тот же паттерн (на Stripe пока 0 phantom,
  потому что redaction skip'ает на endpoints без declared headers)
- response_schema_conformance — тот же паттерн
- content_type_conformance — может быть аналогично

## Варианты фикса

### A. Preserve `originalPath` на `EndpointInfo`
Disambiguator пишет `ep.originalPath = ep.path` перед rename'ом. Checks
которые делают spec lookup используют `originalPath` если есть, иначе
`path`. Минимально-инвазивно, не ломает существующую логику.

### B. Structural lookup
Helper `findOperationInSpec(doc, ep)` который ищет path по сегментной
shape (`{x}` matches `{anything}`). Дороже, но переиспользуем для других checks.

### C. Skip-on-undeclared
Если `op?.responses === undefined || hasDefault === false && codes.size === 0`
→ return `{ kind: "skip", reason: "no responses declared in spec" }`. Самый
дешёвый, но теряет сигнал на API'ях с реально пустыми `responses` (legit
documentation bug).

Рекомендация: **A** — минимальный диф, явный invariant.

## Скоуп

- `EndpointInfo.originalPath: string` (optional, set by disambiguator).
- `status_code_conformance.ts`: lookup использует `originalPath ?? path`.
- Аналогичный fix в `response_headers_conformance`, `response_schema_conformance`,
  `content_type_conformance`, `missing_required_header` (где они тоже
  делают spec lookup).
- Тест на Stripe-style path-disambig сценарий.

## Замер

После фикса prerun на Stripe: 601 → 0 phantom (или сколько реально
недокументированных).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 EndpointInfo.originalPath сохраняется disambiguator'ом до rename'а
- [ ] #2 status_code_conformance + 3 conformance checks используют originalPath для spec lookup
- [ ] #3 тест: Stripe-style disambig сценарий не даёт phantom findings
<!-- AC:END -->
