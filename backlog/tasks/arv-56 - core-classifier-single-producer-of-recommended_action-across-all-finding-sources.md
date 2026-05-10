---
id: ARV-56
title: >-
  core/classifier: single producer of recommended_action across all finding
  sources
status: Done
assignee: []
created_date: '2026-05-10 18:44'
updated_date: '2026-05-10 19:18'
labels:
  - m-17
  - classifier
  - recommended-action
  - agent-contract
milestone: m-17
dependencies:
  - ARV-55
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Накопленный долг: ARV-11 (per-check recommended_action), ARV-42 (recommendedActionForGenerated в db diagnose), TASK-294 (unify across Issue/SecurityFinding/mass-assignment/discover) — все добавляют классификационные ветки в разных местах. TASK-294 пытался унифицировать, но ARV-11/42 добавили новые. Третья итерация — пора заводить отдельный classifier, который берёт ClassifierContext и возвращает action в одном месте.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 src/core/classifier/recommended-action.ts экспортирует classify(ctx: ClassifierContext): RecommendedAction
- [x] #2 ClassifierContext = { run_kind, provenance, status, suite_path, finding_class, baseline_status }; чисто декларативный, без side-effects
- [x] #3 Все consumers переключены на classifier: db diagnose, lint-spec.Issue, probe security.Finding, mass-assignment.Finding, checks.Finding
- [x] #4 Existing logic из ARV-11 и ARV-42 живёт внутри classifier как case-branches, не дублируется в callers
- [x] #5 tests/contracts/classifier.test.ts: 30+ table-driven cases — covering all combinations of (run_kind × status × finding_class) which today produce different actions
- [x] #6 TASK-294 reopens → done; ARV-11 и ARV-42 explicitly subsumed (отметить в task-notes)
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Собрать все existing решения 'когда какой recommended_action' — grep 'recommendedAction' src/.\n2. Перенести в core/classifier/recommended-action.ts как pure function.\n3. Замена call-sites: import classify; передать ClassifierContext.\n4. Удалить inline-logic из callers.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## 2026-05-10 — closed by ARV-56 (m-17 block C, foundation)

- New `src/core/classifier/recommended-action.ts` — single pure `classify(ctx: ClassifierContext): RecommendedAction | undefined`. Declarative switch over finding_class × status × severity × generated-source.
- Migrated consumers:
  - `core/diagnostics/failure-hints.ts` — `recommendedAction` / `recommendedActionForGenerated` are now thin delegates.
  - `core/checks/recommended-action.ts` — `recommendForCheck` maps check id → FindingClass, then delegates. Old `STATIC_TABLE` literal removed.
  - `core/probe/mass-assignment-probe.ts` — `stampRecommendedAction` calls `classify` instead of its own severity switch.
  - `core/probe/security-probe.ts` — `stampAction` ditto.
  - `core/diagnostics/db-analysis.ts` keeps its post-classify env_issue override (`f.recommended_action = "fix_env"`) — that's a producer-side context the classifier intentionally doesn't see (decided by inter-suite clustering).
- New contract suite `tests/contracts/classifier.test.ts` — 41 table-driven cases covering every finding_class × notable input. Closes AC#5 (>30 cases).
- ARV-11 and ARV-42 inputs are now case-branches inside classifier rather than separate code paths; TASK-294 unification is fully achieved (lint:issue, checks/*, probe:*, test:* all flow through the same function).
- `bun run check` clean; `bun test` — 1674/1674 pass across 142 files.
<!-- SECTION:NOTES:END -->
