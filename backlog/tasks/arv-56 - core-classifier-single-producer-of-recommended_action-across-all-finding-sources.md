---
id: ARV-56
title: >-
  core/classifier: single producer of recommended_action across all finding
  sources
status: To Do
assignee: []
created_date: '2026-05-10 18:44'
labels:
  - m-17
  - classifier
  - recommended-action
  - agent-contract
dependencies:
  - ARV-55
priority: medium
milestone: m-17
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Накопленный долг: ARV-11 (per-check recommended_action), ARV-42 (recommendedActionForGenerated в db diagnose), TASK-294 (unify across Issue/SecurityFinding/mass-assignment/discover) — все добавляют классификационные ветки в разных местах. TASK-294 пытался унифицировать, но ARV-11/42 добавили новые. Третья итерация — пора заводить отдельный classifier, который берёт ClassifierContext и возвращает action в одном месте.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 src/core/classifier/recommended-action.ts экспортирует classify(ctx: ClassifierContext): RecommendedAction
- [ ] #2 ClassifierContext = { run_kind, provenance, status, suite_path, finding_class, baseline_status }; чисто декларативный, без side-effects
- [ ] #3 Все consumers переключены на classifier: db diagnose, lint-spec.Issue, probe security.Finding, mass-assignment.Finding, checks.Finding
- [ ] #4 Existing logic из ARV-11 и ARV-42 живёт внутри classifier как case-branches, не дублируется в callers
- [ ] #5 tests/contracts/classifier.test.ts: 30+ table-driven cases — covering all combinations of (run_kind × status × finding_class) which today produce different actions
- [ ] #6 TASK-294 reopens → done; ARV-11 и ARV-42 explicitly subsumed (отметить в task-notes)
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Собрать все existing решения 'когда какой recommended_action' — grep 'recommendedAction' src/.\n2. Перенести в core/classifier/recommended-action.ts как pure function.\n3. Замена call-sites: import classify; передать ClassifierContext.\n4. Удалить inline-logic из callers.
<!-- SECTION:PLAN:END -->
