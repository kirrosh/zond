---
id: TASK-189
title: 'refactor: extract live probe harness (endpoint loop + cleanup)'
status: To Do
assignee: []
created_date: '2026-05-07 08:00'
labels:
  - refactor
  - probe
milestone: m-11
dependencies:
  - task-188
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
TASK-185 (core/probe/runner.ts) вытащил только static-scaffold (loadSpec/writeSuites). Live-runtime (HTTP-цикл по endpoints + snapshot/cleanup) всё ещё дублируется между `mass-assignment-probe.ts` (1031) и `security-probe.ts` (981). `tryCleanup` в security-probe полнее (eventual-consistency retry, accumulated cleanup-error в verdict), а `tryCleanupBaseline` в mass-assignment — best-effort fire-and-forget.

Цель: единый `core/probe/probe-harness.ts` с
- `buildProbeRequest(ep, schemes, vars, payload)` — URL + headers + auth
- `executeWithCleanup(opts)` — запуск + DELETE counterpart с настраиваемым retry-режимом и error-callback'ом

Mass-assignment cleanup получает retry-семантику бесплатно (текущий fire-and-forget — сам по себе bug-risk: тихая утечка baseline-ресурсов).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 src/core/probe/probe-harness.ts экспортирует buildProbeRequest/executeWithCleanup
- [ ] #2 mass-assignment-probe.ts и security-probe.ts используют harness
- [ ] #3 tryCleanup* удалены из обоих probe-файлов
- [ ] #4 round-5 retry-семантика (eventual-consistency 404) работает в обоих probes
- [ ] #5 bun test покрывает оба probe — зелёные
- [ ] #6 строк суммарно меньше минимум на 150
<!-- AC:END -->
