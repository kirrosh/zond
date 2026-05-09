---
id: ARV-7
title: 'cli: --mode positive/negative/all явный переключатель'
status: To Do
assignee: []
created_date: '2026-05-09 15:47'
labels:
  - cli
  - m-15
  - depth
  - ux
dependencies:
  - ARV-1
milestone: m-15
priority: medium
---

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Флаг --mode работает в run/checks/generate, дефолт all
- [ ] #2 Snapshot активного списка checks для каждого режима
- [ ] #3 Snapshot количества cases на одном operation для каждого режима
- [ ] #4 ZOND.md и --help секция упоминают flag
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Глобальный флаг `--mode positive|negative|all` для `run`, `checks`, `generate`. Управляет:
- какие cases генерируются (только валидные / только мутированные / оба, default `all`),
- какие checks автоматически активны: `negative_data_rejection` имеет смысл только при `negative`/`all`; `positive_data_acceptance` — при `positive`/`all`.

Документировать в --help, ZOND.md, skill zond-checks.
<!-- SECTION:PLAN:END -->
