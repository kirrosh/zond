---
id: ARV-176
title: >-
  refresh-api: --merge-schema patch.schema.json → spec.json +
  .api-resources.local.yaml
status: Done
assignee: []
created_date: '2026-05-12 13:26'
updated_date: '2026-07-03 16:43'
labels:
  - depth
  - spec
  - deferred-m-21
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Цель

Блок A m-18, пара к ARV-175. Мерж `patch.schema.json` (от schema-from-runs)
в upstream `spec.json` под `responses.<code>.content[application/json].schema`.

Сохранение в `.api-resources.local.yaml` через extension-mechanism (ARV-111),
чтобы не терялось на следующем `zond refresh-api` upstream.

## Поведение

- merge не перезаписывает существующие `schema` в upstream spec; только
  заполняет где их нет (за исключением `--force`)
- конфликт (endpoint есть в patch, но изменился path в upstream) → warning,
  endpoint скипается
- merge-результат идёт в `.api-resources.local.yaml` как overlay,
  а не в spec.json напрямую (чтобы upstream refresh не терял патч)

## Зависимости

- ARV-175 — источник patch.schema.json
- ARV-111 — extension mechanism
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 zond refresh-api --merge-schema patch.schema.json мержит response schemas в overlay
- [x] #2 повторный refresh-api без флага сохраняет overlay из .api-resources.local.yaml
- [x] #3 конфликты path/endpoint логируются и скипаются
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
refresh-api --merge-schema merges patch into .api-schema.local.yaml overlay (mergePatch union) + applies onto doc before spec.json write. Overlay re-applied on every refresh (apply-always, not flag-gated) → survives upstream re-pull (AC#2). Gap-fill only unless --force; path/method absent upstream → conflict logged+skipped (AC#3). Chose dedicated .api-schema.local.yaml over .api-resources.local.yaml (resource-shaped) — noted in commit. Core: core/spec/schema-overlay.ts. Tests: tests/core/spec/schema-overlay.test.ts (7).
<!-- SECTION:NOTES:END -->
