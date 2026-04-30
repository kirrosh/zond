---
id: TASK-101
title: failure classification — definitely_bug / likely_bug / quirk
status: To Do
assignee: []
created_date: '2026-04-30 09:35'
labels:
  - trust-loop
  - decision-5
  - data
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Контекст

Сегодня UI/CLI отдают только `pass` / `fail` + `recommended_action`.
В trust loop (decision-5) бэкендер должен за секунду понять:
«это реально баг или quirk зонда / probe-фолс-позитив».

## Что добавляем

Новое поле `failure_class` в structured envelope каждого failure:

| Класс             | Значит                                                          |
|-------------------|------------------------------------------------------------------|
| `definitely_bug`  | Спека гарантирует X, ответ ≠ X. Без вариантов.                  |
| `likely_bug`      | Поведение странное, но допустимо разные интерпретации.          |
| `quirk`           | Edge-case реализации, не баг (вернул 400 вместо 422 — ОК).      |
| `env_issue`       | (уже есть) — проблема окружения, не API.                        |

Reasoning попадает в `failure_class_reason: "...one-liner..."` чтобы
UI показал и почему именно этот класс.

## Правила классификации (стартовый набор)

- 5xx на любом success-path test → `definitely_bug`
- Schema validation failure (response не матчит spec) → `definitely_bug`
- Mass-assignment extras NOT rejected на mutating endpoint → `definitely_bug`
- Negative-probe ожидал 4xx, получил другой 4xx → `quirk`
- Negative-probe ожидал 4xx, получил 2xx → `likely_bug`
- Idempotency-key conflict не воспроизвёлся → `likely_bug`

## Где меняется код

- `src/core/diagnostics/failure-hints.ts` — расширить existing logic
  (там уже есть env_issue heuristics).
- `src/core/runner/types.ts` — добавить `failure_class` и
  `failure_class_reason` в StepResult.
- `src/db/schema.ts` — ALTER TABLE results ADD COLUMN failure_class TEXT
  (nullable; null для passed).
- `src/cli/json-envelope.ts` — пропустить новое поле в JSON-envelope.

## Тесты

- Классификация по каждому правилу на фикстурах в tests/diagnostics/.
- failure_class === null для status === "pass".
- DB round-trip.
- Backward-compat: если step без failure_class в DB (старые runs) —
  UI/CLI рендерят как «unclassified», без crash.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 failure_class присваивается всем failures по правилам в task description
- [ ] #2 failure_class_reason несёт one-liner why
- [ ] #3 Поле прокинуто в StepResult, JSON-envelope, results.failure_class в DB
- [ ] #4 Старые runs без классификации рендерятся как unclassified, не падают
<!-- AC:END -->
