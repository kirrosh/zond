---
id: ARV-292
title: >-
  budget flag (quick/standard/full): adaptive --max-requests cap for corpus +
  60-sec gate UX
status: Done
assignee: []
created_date: '2026-05-18 11:36'
updated_date: '2026-05-18 14:10'
labels:
  - m-23
  - corpus
  - budget
  - ux
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Контекст

Сейчас `--max-requests` хардкодит число запросов без vendor-aware дефолтов. Для m-23 public corpus нужен adaptive budget: 4000-endpoint Stripe не должен съесть весь cron-budget, при этом маленькая команда должна получить «60-сек прогон» как primary UX (strategy §3.1.1).

## Решение

`--budget quick|standard|full` flag:
- `quick`: 50 req hard cap, no stateful checks → 60-sec gate
- `standard` (default): 500 req cap, all per-response + sampled stateful
- `full`: uncapped, all checks

Сохраняем совместимость с `--max-requests N` (override).

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 #1 `--budget` flag added to `zond audit/checks run/corpus run`
- [x] #2 #2 Tier mapping реализован в options layer
- [x] #3 #3 `--max-requests` override берёт верх над budget
- [x] #4 #4 Regression test: quick budget на mock-API завершается < 60s wall-clock

## Связано

- m-23 milestone
- ARV-227 (--max-requests origin)
- strategy.md §3.1
<!-- SECTION:DESCRIPTION:END -->

<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Реализовано: src/core/checks/budget.ts (resolveBudget + isBudget), --budget flag на checks run и audit, skipStateful в RunChecksOptions с surface через summary.skipped_outcomes['stateful-skipped:budget']. Tier mapping: quick=50req+no-stateful, standard=500req+all, full=uncapped+all. --max-requests override всегда выигрывает. --check stateful опт-обратно в stateful даже под quick (forceStatefulIfIncluded). Omitted --budget сохраняет legacy uncapped (no silent regression). Unit-тесты budget.test.ts 10/10 + regression checks-budget.test.ts 4/4 (quick < 60s wall-clock на mock-API). corpus run не делался — команды нет (ARV-291). bun run check зелёный, bun test 2456/2457 (pre-existing ARV-196 fail unrelated).
<!-- SECTION:FINAL_SUMMARY:END -->
