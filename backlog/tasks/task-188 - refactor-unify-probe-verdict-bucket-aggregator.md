---
id: TASK-188
title: 'refactor: unify probe verdict bucket aggregator'
status: Done
assignee: []
created_date: '2026-05-07 08:00'
updated_date: '2026-05-07 08:30'
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
- [x] #1 src/core/probe/verdict-aggregator.ts экспортирует generic tallyBySeverity/formatSummaryLine
- [x] #2 probe-mass-assignment.ts и probe-security.ts больше не содержат локальных countBuckets/printSeverityLine
- [x] #3 stdout двух команд — байт-в-байт прежний (формат строки и ключи JSON-envelope сохранены)
- [x] #4 bun run check + bun test зелёные (1049 pass)
<!-- AC:END -->
