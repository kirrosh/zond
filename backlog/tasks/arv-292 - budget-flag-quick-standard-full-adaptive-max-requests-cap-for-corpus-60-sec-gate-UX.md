---
id: ARV-292
title: >-
  budget flag (quick/standard/full): adaptive --max-requests cap for corpus +
  60-sec gate UX
status: To Do
assignee: []
created_date: '2026-05-18 11:36'
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

- [ ] #1 `--budget` flag added to `zond audit/checks run/corpus run`
- [ ] #2 Tier mapping реализован в options layer
- [ ] #3 `--max-requests` override берёт верх над budget
- [ ] #4 Regression test: quick budget на mock-API завершается < 60s wall-clock

## Связано

- m-23 milestone
- ARV-227 (--max-requests origin)
- strategy.md §3.1
<!-- SECTION:DESCRIPTION:END -->
