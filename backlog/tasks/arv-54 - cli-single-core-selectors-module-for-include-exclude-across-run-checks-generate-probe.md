---
id: ARV-54
title: >-
  cli: single core/selectors module for --include/--exclude across run, checks,
  generate, probe
status: To Do
assignee: []
created_date: '2026-05-10 18:44'
labels:
  - m-17
  - cli
  - refactor
  - selectors
  - agent-contract
dependencies:
  - ARV-49
priority: medium
milestone: m-17
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
ARV-9 AC#3 (все 4 команды поддерживают одинаковый синтаксис) и AC#6 (wire в zond probe и zond run) deferred. ARV-25 добавил --include/--exclude в zond run отдельным куском кода — дубликат с checks. После ARV-49 (Probe interface) probe тоже должен использовать общий filter. Один shared module — иначе расхождение копится при каждом добавлении новой команды.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 src/core/selectors/operation-filter.ts экспортирует parseSelector(args) → Selector и applySelector(selector, operations[]) → operations[]
- [ ] #2 Поддерживаемые синтаксисы: --include path:/users/.*, method:GET,POST, tag:billing, operation-id:getUser*
- [ ] #3 Все 4 потребителя (run, checks, generate, probe via Probe.commonFlags) используют один импорт; нет локальных дубликатов в cli/commands/
- [ ] #4 ARV-9 AC#3 закрыт; ARV-9 AC#6 закрыт (через ARV-49 + ARV-52)
- [ ] #5 tests/contracts/selectors.test.ts: 20+ table-driven cases (path glob, method case-insensitive, tag combinations, conflicting include+exclude)
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Найти существующие дубликаты: grep 'parseInclude\|applyFilter' src/cli/commands/.\n2. Слить логику в core/selectors/operation-filter.ts.\n3. Замена импортов в run, checks, generate; probe-команды получают filter через Probe.commonFlags после ARV-49.\n4. Снести локальные impl'ы.
<!-- SECTION:PLAN:END -->
