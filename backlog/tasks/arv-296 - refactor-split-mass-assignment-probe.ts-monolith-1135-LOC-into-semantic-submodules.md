---
id: ARV-296
title: >-
  refactor: split mass-assignment-probe.ts monolith (1135 LOC) into semantic
  submodules
status: Done
assignee: []
created_date: '2026-05-18 12:56'
updated_date: '2026-05-18 13:41'
labels:
  - refactor
  - hygiene
  - validation-sprint
  - m-23
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
src/core/probe/mass-assignment-probe.ts вырос до 1135 LOC. Содержит сразу: read-only field detection, payload generation, baseline diff, evidence-chain, FP-фильтры. Каждый из этих шагов — независимая фаза, которая просится в свой файл. Cost: 1 день. Risk: low. Выявлено в pre-release refactor review 2026-05-18.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 core/probe/mass-assignment/index.ts собирает orchestration
- [x] #2 Тесты на mass-assignment проходят без модификации
- [x] #3 Сигнатуры публичного API не меняются
- [x] #4 Per-aspect split (2026-05-18): types / suspects / classify / cleanup / digest / regression вынесены в core/probe/mass-assignment/*.ts
- [ ] #5 core/probe/mass-assignment-probe.ts остаётся как barrel re-export, public API не изменился (SUSPECTED_FIELDS, Severity, FieldVerdict, EndpointVerdict, MassAssignmentOptions, MassAssignmentResult, runMassAssignmentProbes, isSubscriptionGated, formatDigestMarkdown, emitRegressionSuites)
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
mass-assignment-probe.ts (1135 LOC) разбит на per-aspect модули в core/probe/mass-assignment/: types, suspects, classify, cleanup, digest, regression, orchestrator. mass-assignment-probe.ts стал barrel re-export. Public API не менялся. 53 mass-assignment + связанных теста зелёные, tsc --noEmit чистый. Самый большой модуль — orchestrator.ts (~400 LOC).
<!-- SECTION:FINAL_SUMMARY:END -->
