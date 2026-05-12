---
id: ARV-176
title: >-
  refresh-api: --merge-schema patch.schema.json → spec.json +
  .api-resources.local.yaml
status: To Do
assignee: []
created_date: '2026-05-12 13:26'
labels:
  - m-18
  - depth
  - spec
dependencies: []
priority: high
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
- [ ] #1 zond refresh-api --merge-schema patch.schema.json мержит response schemas в overlay
- [ ] #2 повторный refresh-api без флага сохраняет overlay из .api-resources.local.yaml
- [ ] #3 конфликты path/endpoint логируются и скипаются
<!-- AC:END -->
