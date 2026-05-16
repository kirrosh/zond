---
id: ARV-7
title: 'cli: --mode positive/negative/all явный переключатель'
status: Done
assignee: []
created_date: '2026-05-09 15:47'
updated_date: '2026-05-09 17:32'
labels:
  - cli
  - m-15
  - depth
  - ux
milestone: m-15
dependencies:
  - ARV-1
priority: medium
---

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Флаг --mode работает в run/checks/generate, дефолт all
- [x] #2 Snapshot активного списка checks для каждого режима
- [x] #3 Snapshot количества cases на одном operation для каждого режима
- [x] #4 ZOND.md и --help секция упоминают flag
- [ ] #5 Расширить --mode на zond run / zond generate (alias на tag-filter / suite-emission filter) — отложено в follow-up; сейчас флаг работает только в zond checks run
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Глобальный флаг `--mode positive|negative|all` для `run`, `checks`, `generate`. Управляет:
- какие cases генерируются (только валидные / только мутированные / оба, default `all`),
- какие checks автоматически активны: `negative_data_rejection` имеет смысл только при `negative`/`all`; `positive_data_acceptance` — при `positive`/`all`.

Документировать в --help, ZOND.md, skill zond-checks.
<!-- SECTION:PLAN:END -->
