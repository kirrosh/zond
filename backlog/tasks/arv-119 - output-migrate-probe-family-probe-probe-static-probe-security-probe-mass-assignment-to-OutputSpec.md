---
id: ARV-119
title: >-
  output: migrate probe family (probe + probe-static + probe-security +
  probe-mass-assignment) to OutputSpec
status: To Do
assignee: []
created_date: '2026-05-11 10:13'
updated_date: '2026-05-11 10:14'
labels:
  - m-19
  - refactor
  - blocker-m-18
dependencies:
  - ARV-116
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
§1.4 refactor-plan. Семейство probe сейчас имеет три параллельных парсера --report markdown|json + три копии --output логики. После ARV-116 — единый.

Изменения:
- src/cli/commands/probe.ts: probe-OutputSpec
- три подкоманды (static/security/mass-assignment) используют общий probe-OutputSpec
- удалить дублирующиеся опции --output / --report из подкоманд (наследуются от parent)
- markdown digest идёт в --output / --report markdown, JSON envelope структурированный (m-17 ARV-51 поведение зафиксировано)
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 три подкоманды probe используют один OutputSpec
- [ ] #2 src/cli/commands/probe-*.ts (top-level дубликаты) удалены — см. отдельный task
- [ ] #3 tests/cli/probe-*.test.ts зелёные
<!-- AC:END -->
