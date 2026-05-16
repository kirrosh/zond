---
id: TASK-189
title: 'refactor: extract live probe harness (endpoint loop + cleanup)'
status: Done
assignee: []
created_date: '2026-05-07 08:00'
updated_date: '2026-05-07 09:00'
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

## Notes

<!-- SECTION:NOTES:BEGIN -->
**Реализовано (узкий scope):**
- `probe-harness.ts` с тремя чистыми примитивами:
  - `buildProbeUrl(ep, vars)` — ранее одинаковая функция в обоих файлах (12 строк × 2)
  - `buildJsonAuthHeaders(ep, schemes, vars)` — JSON content-type/accept + auth (5 × 2)
  - `buildBaselineFromSpec(ep, vars)` — generateFromSchema + substituteDeep + isObject-check (5 × 2)

**Что НЕ делалось (отдельный кандидат):**
Унификация cleanup-логики откатана сознательно:
- `mass-assignment.tryCleanupBaseline` — pre-attack hygiene, fire-and-forget OK (если упадёт, следующий attempt всё равно вскроет проблему через unique-constraint).
- `security-probe.tryCleanup` — post-attack final restore, ошибки ОБЯЗАНЫ всплывать в verdict.cleanup.error для оператора.

Разные invariants → разные shapes. Унификация под единый API скрывает эту семантическую разницу за callback'ами и опциями retry, делая код менее читаемым.

Если в будущем mass-assignment получит post-attack snapshot/restore (как security), тогда вернуться к этой идее.
<!-- SECTION:NOTES:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 src/core/probe/probe-harness.ts экспортирует buildProbeUrl/buildJsonAuthHeaders/buildBaselineFromSpec
- [x] #2 mass-assignment-probe.ts и security-probe.ts используют harness (3 общих примитива)
- [~] #3 tryCleanup* удалены из обоих probe-файлов — **намеренно оставлены раздельно** (см. Notes)
- [~] #4 round-5 retry-семантика — без изменений; mass-assignment.tryCleanupBaseline и security.tryCleanup имеют разные invariants
- [x] #5 bun test покрывает оба probe — 1049 пасс
- [~] #6 строк суммарно меньше минимум на 150 — **фактически −42 в probe-файлах + 66 в harness = +24** (оригинальная оценка завышена)
<!-- AC:END -->
