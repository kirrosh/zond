---
id: ARV-182
title: 'm-18 decision: fuzz engine (m-19) — defer, not block m-18'
status: Done
assignee: []
created_date: '2026-05-13 06:56'
updated_date: '2026-05-13 11:25'
labels:
  - m-18
  - decision
  - m-19-trigger
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Цель

Зафиксировать решение по m-19 (fuzz engine) на основе данных m-18 D-блока,
**отложить**, не закрывать.

## Контекст

Parity-замер на Resend (write-heavy API, 47 endpoint'ов) дал ~56
schemathesis-only findings, которые по природе — fuzz-generation:
- `positive_data_acceptance`: 41 (schemathesis генерит valid-shape, API reject)
- `negative_data_rejection`: 12 (invalid payloads accepted)
- `not_a_server_error`: 3 (fuzz-input → 5xx)

На Sentry (GET-heavy) fuzz-эффект пренебрежимо мал (~2 findings).

## Что фиксируем

1. m-19 (fuzz engine) **не закрывается** на основании m-18 — он реально
   нужен для write-heavy API.
2. m-19 **не блокирует m-18** — на Sentry-style API он не помогает,
   и cheap-fix'ы (ARV-179/180/181) дадут больший выигрыш.
3. m-19 priority: **medium**, не high. Делать после m-20 (state-aware).

## Что выяснить позже (брейншторм для m-19)

- Какой PBT-style fuzz нужен для positive_data_acceptance?
  → schemathesis V4 использует hypothesis под капотом. Минимальный port —
  shrinker + value-shrinking стратегия per schema type.
- Shrinker — обязателен (без него findings нечитаемы).
- Reuse существующего coverage-generator (ARV-6) как seed phase, fuzz
  как дополнительная phase сверху.
- Anti-FP: positive_data_acceptance известен своим FP rate в schemathesis
  (issues #2312/#2978) — нужны guards с самого начала.

## Действие

- Создать draft milestone m-19 с этими 4 пунктами + ссылкой на
  `backlog/notes/m-18-parity-baseline.md`.
- Не заводить ARV-задачи внутрь — это после закрытия m-18 и m-20.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 draft milestone m-19 создан с 4 пунктами + ссылкой на parity-baseline
- [ ] #2 decision-документ backlog/notes/m-18-decision.md финализирован
<!-- AC:END -->
