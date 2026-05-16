---
id: ARV-8
title: 'runner: --workers N async-pool на Bun (concurrency без threading)'
status: Done
assignee: []
created_date: '2026-05-09 15:47'
updated_date: '2026-05-09 18:05'
labels:
  - runner
  - m-15
  - depth
  - perf
milestone: m-15
dependencies: []
priority: high
---

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Pool-mock с фиксированной задержкой: --workers 8 даёт ~total/8 wall-time
- [x] #2 Race-test: 100 concurrent requests на mock — rate-limiter не пропускает > N RPS
- [x] #3 Stability: --workers 16 на petstore mock — все CRUD-chains проходят (parents seq, siblings parallel)
- [x] #4 Backward-compat: без --workers поведение идентично текущему (default 1)
- [x] #5 Документация: --workers auto = min(cpus, 8), max 64
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Заменить sequential `for-await` в `runner/executor.ts` на bounded async-pool (p-limit-style на pure Bun).
2. Default `--workers 1` (backward-compat). `--workers auto` = min(cpus, 8). Max 64.
3. Rate-limiter глобально через semaphore поверх pool (не в каждом worker), уважая `runner/rate-limiter.ts`.
4. КРИТИЧНО: pool — на endpoint-параллелизм, **не** на case-параллелизм внутри одного endpoint. Иначе ломаются CRUD-chains (parents должны создаваться последовательно).
5. Распространить --workers на: zond run, zond checks run, zond probe *.
<!-- SECTION:PLAN:END -->
