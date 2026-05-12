---
id: ARV-144
title: 'zond request --json-path can''t address top-level array body (e.g. [0].id)'
status: Done
assignee: []
created_date: '2026-05-12 07:40'
updated_date: '2026-05-12 08:03'
labels:
  - bug
  - request
  - json-path
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Sentry round-02: zond request GET .../issues/ --json-path 'data[0].id' падает с подсказкой 'not the zond envelope' — но Sentry endpoint реально отдаёт top-level array body (это норма для многих REST API: Sentry, GitHub, k8s style). Источник: feedback-02 F10.

Нужен синтаксис --json-path '[0].id' или --json-path '0.id' для top-level arrays. Hint должен быть точнее: 'top-level array — try --json-path \"[0].field\"' вместо envelope-confusion.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 --json-path '[0].id' и '--json-path 0.id' резолвят top-level array element
- [ ] #2 Hint при ошибке отличает 'envelope wrapper' от 'top-level array' и показывает корректный синтаксис
- [ ] #3 --help примеры включают top-level-array кейс
<!-- AC:END -->
