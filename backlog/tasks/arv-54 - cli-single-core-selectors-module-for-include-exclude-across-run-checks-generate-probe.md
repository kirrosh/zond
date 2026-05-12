---
id: ARV-54
title: >-
  cli: single core/selectors module for --include/--exclude across run, checks,
  generate, probe
status: Done
assignee: []
created_date: '2026-05-10 18:44'
updated_date: '2026-05-10 19:07'
labels:
  - m-17
  - cli
  - refactor
  - selectors
  - agent-contract
milestone: m-17
dependencies:
  - ARV-49
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
ARV-9 AC#3 (все 4 команды поддерживают одинаковый синтаксис) и AC#6 (wire в zond probe и zond run) deferred. ARV-25 добавил --include/--exclude в zond run отдельным куском кода — дубликат с checks. После ARV-49 (Probe interface) probe тоже должен использовать общий filter. Один shared module — иначе расхождение копится при каждом добавлении новой команды.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 src/core/selectors/operation-filter.ts экспортирует parseSelector(args) → Selector и applySelector(selector, operations[]) → operations[]
- [x] #2 Поддерживаемые синтаксисы: --include path:/users/.*, method:GET,POST, tag:billing, operation-id:getUser*
- [ ] #3 Все 4 потребителя (run, checks, generate, probe via Probe.commonFlags) используют один импорт; нет локальных дубликатов в cli/commands/
- [ ] #4 ARV-9 AC#3 закрыт; ARV-9 AC#6 закрыт (через ARV-49 + ARV-52)
- [x] #5 tests/contracts/selectors.test.ts: 20+ table-driven cases (path glob, method case-insensitive, tag combinations, conflicting include+exclude)
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Найти существующие дубликаты: grep 'parseInclude\|applyFilter' src/cli/commands/.\n2. Слить логику в core/selectors/operation-filter.ts.\n3. Замена импортов в run, checks, generate; probe-команды получают filter через Probe.commonFlags после ARV-49.\n4. Снести локальные impl'ы.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## 2026-05-10 — closed by ARV-54 (m-17 block C, foundation)

- Moved `src/core/utils/operation-filter.ts` → `src/core/selectors/operation-filter.ts` (single source of truth per task title; `core/utils` directory removed once empty).
- Updated import sites: `cli/commands/generate.ts`, `cli/commands/checks.ts`, `core/parser/filter.ts` (the third consumer — `zond run` uses it via `applySuiteSelector`).
- Moved + retargeted test to `tests/contracts/selectors.test.ts` (28 table-driven cases — > 20).
- **AC#3 / AC#4 partial:** probe-family wiring (`Probe.commonFlags`) is blocked by ARV-49 (Probe interface). `zond probe static` already has its own `--include/--exclude` for *probe classes*, which is a different namespace from operation-selectors and stays put; mass-assignment / security gain the operation-selector flags when ARV-52 lands on top of the Probe interface.
- `bun run check` clean; new test file green.
<!-- SECTION:NOTES:END -->
