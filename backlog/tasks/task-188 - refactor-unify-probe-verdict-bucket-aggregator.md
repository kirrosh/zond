---
id: TASK-188
title: 'refactor: unify probe verdict bucket aggregator'
status: To Do
assignee: []
created_date: '2026-05-07 08:00'
labels:
  - refactor
  - probe
milestone: m-11
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
`probe-mass-assignment.ts` и `probe-security.ts` дублируют почти одинаковые `countBuckets()` + `printSeverityLine()` (~40 строк ×2). Различие — лишь в наборе severity-веток (`medium` vs `inconclusive`). Извлечь в `core/probe/verdict-aggregator.ts` generic-агрегатор по списку severities и общий формат summary-строки.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 src/core/probe/verdict-aggregator.ts экспортирует generic countBuckets/formatSummary
- [ ] #2 probe-mass-assignment.ts и probe-security.ts больше не содержат локальных countBuckets/printSeverityLine
- [ ] #3 stdout двух команд — байт-в-байт прежний
- [ ] #4 bun run check + bun test зелёные
<!-- AC:END -->
