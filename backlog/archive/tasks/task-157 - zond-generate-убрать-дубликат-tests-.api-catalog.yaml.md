---
id: TASK-157
title: 'zond generate: убрать дубликат tests/.api-catalog.yaml'
status: Done
assignee: []
created_date: '2026-05-06 06:38'
updated_date: '2026-05-06 09:56'
labels:
  - lifecycle
  - generate
  - bug
milestone: m-9
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Контекст

Источник: [m-9 feedback round 5](../notes/m-9-workspace-hygiene/feedback-original.md), §P1.

`zond generate` кладёт `apis/<name>/tests/.api-catalog.yaml` —
дубликат root-уровневого `apis/<name>/.api-catalog.yaml`. Путает с
основным артефактом. Возможно legacy.

## Что сделать

1. Найти точку, где `generate` пишет `tests/.api-catalog.yaml`.
2. Убрать запись (или сделать опциональной с явным флагом).
3. Если он используется внутри generated tests — заменить ссылку на
   root-уровневый.
4. Регрессия: после `zond generate` в `tests/` не должно быть
   `.api-catalog.yaml`.

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 После `zond generate` в `apis/<name>/tests/` отсутствует `.api-catalog.yaml`.
- [ ] #2 Existing tests/runs не ломаются (root-level catalog остаётся).
- [ ] #3 Если функционал нужен — есть отдельный флаг с явным opt-in.
<!-- SECTION:DESCRIPTION:END -->

<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Generate stopped writing tests/.api-catalog.yaml. apis/<name>/.api-catalog.yaml from add-api/refresh-api is the only catalog. Verified: after generate, tests/ contains only suite YAMLs.
<!-- SECTION:NOTES:END -->
