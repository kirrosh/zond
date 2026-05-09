---
id: TASK-300
title: consolidate probe-validation + probe-methods into zond probe static
status: Done
assignee: []
created_date: '2026-05-09 07:00'
labels:
  - cli-surface
  - consolidation
  - probe
  - m-13
  - breaking
milestone: m-13
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Обе — static-input проверки (validation: bogus типы; methods: 405/несуществующие методы). Слить в zond probe static [--include validation,methods]. Старые команды → deprecated alias. Связано с TASK-182 (umbrella). Источник: audit-and-consolidation.md §4 спринт 1.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 zond probe static покрывает validation+methods
- [x] #2 --include validation,methods (или --exclude) фильтр работает
- [x] #3 Старые команды удалены без deprecation alias (см. TASK-298 как прецедент: оба surface — workspace-input, единая ментальная модель)
- [x] #4 Документация обновлена
<!-- AC:END -->
