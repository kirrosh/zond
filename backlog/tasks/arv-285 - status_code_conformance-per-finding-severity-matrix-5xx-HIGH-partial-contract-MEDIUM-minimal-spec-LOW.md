---
id: ARV-285
title: >-
  status_code_conformance: per-finding severity matrix (5xx HIGH /
  partial-contract MEDIUM / minimal-spec LOW)
status: To Do
assignee: []
created_date: '2026-05-18 10:34'
labels:
  - severity
  - calibration
  - proof-cap
  - ARV-250
  - follow-up-ARV-284
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Контекст

`status_code_conformance` декларирован `severity: 'medium'` глобально. Per ARV-284 pattern и ARV-250 proof-cap — корректнее дать per-finding dispatch через `outcome.severity`, потому что три разных вида findings имеют сильно разный evidence weight:

- 5xx, который не задекларирован → реальное расхождение runtime ↔ spec, сервер падает в режиме о котором контракт молчит. Сильный signal.
- 4xx undeclared, когда другие 4xx уже declared → контракт частично описывает error-bucket, есть конкретная дыра (e.g. 400 declared, 422 нет).
- 4xx undeclared, когда у operation вообще ни одного 4xx не declared → spec минимальная, "0 vs N" — это не "contract violated", а "contract not described". Конформанс есть, но weak evidence.
- 2xx/3xx undeclared на negative_data / missing_required_header / unsupported_method case kinds → негативный input может породить "чуть иной success" (201 vs 200), single-signal, ambiguous.

ARV-283 config поверх работает как vendor overlay (per-API tuning), но baseline нужен правильный.

## Решение

`statusCodeConformance.severity = 'low'` (proof-cap baseline). `run()` возвращает `outcome.severity` по матрице:

| evidence                                                                     | severity |
|------------------------------------------------------------------------------|----------|
| `response.status` ∈ [500..599], не в declared/wildcard, нет default          | high     |
| `response.status` ∈ [400..499], declared есть хотя бы один 4xx, актуальный отсутствует | medium |
| `response.status` ∈ [400..499], в op.responses нет ни одного 4xx             | low      |
| `response.status` ∈ [200..399], case.kind ∈ {negative_data, missing_required_header, unsupported_method} | low |
| `response.status` ∈ [200..399], case.kind = positive                         | medium   |

`declaredStatuses()` уже возвращает `codes: Set<number>` — достаточно посмотреть есть ли codes ∈ [400..499] чтобы решить partial vs minimal.

## Evidence audit

- Доступно из `c.operation.method` + `c.kind` + `response.status` + результат `declaredStatuses()`.
- Дополнительный сигнал из case kind: positive vs negative_data важен — спойлер unexpected 2xx на negative-input скорее всего vendor-quirk, а unexpected 2xx на positive — контракт.

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 statusCodeConformance.severity = 'low'; run() возвращает per-finding severity по матрице (5xx HIGH / partial-contract 4xx MEDIUM / minimal-spec 4xx LOW / 2xx-negative LOW / 2xx-positive MEDIUM)
- [ ] #2 tests/core/checks/status-code-conformance-severity.test.ts лочит все 6 классов матрицы
- [ ] #3 ARV-282 Stripe scan baseline: severity-counts logged, 700+ unit tests pass

## Связано

- ARV-284 (pattern: per-finding dispatch + declared=low proof-cap)
- ARV-250 (severity matrix overhaul)
- ARV-283 (severity.yaml — vendor overlay)
- `project_zond_positioning_pivot` (no evidence → no high)
<!-- SECTION:DESCRIPTION:END -->
<!-- AC:END -->
