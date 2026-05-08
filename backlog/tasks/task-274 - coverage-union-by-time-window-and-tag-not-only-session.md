---
id: TASK-274
title: 'coverage --union: по time-window и tag, не только session'
status: To Do
assignee: []
created_date: '2026-05-08 18:00'
labels:
  - feedback-loop
  - api-sentry
  - coverage
  - cli
dependencies:
  - task-255
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Source: feedback-13 TL;DR, class missing-feature.

`zond coverage --union session` закрыл главный пробел (см. TASK-255), но реальные сценарии хотят union по другим окнам:

- «за последний час» — для CI-агрегатов между разными session-id;
- «по tag» (например, `--tag negative`, `--tag smoke`) — чтобы понять, какой класс сьютов покрывает что;
- «между двумя run_id» — для сравнения релизов.

Без этих режимов пользователи продолжают писать jq-хаки поверх `runs.db`.

Expected:
- `zond coverage --union session|since:<duration>|tag:<name>|runs:A,B`;
- объединение run-листа делается одним `WHERE` по db, а не повторным прогоном тестов.

Actual: только session-aware union; всё остальное — jq.

Связано: TASK-251, TASK-255, TASK-270 (терминология hit/pass).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria

<!-- SECTION:ACCEPTANCE:BEGIN -->
- [ ] `--union since:<dur>` поддерживает `1h`/`24h`/`7d`-формат, фильтрует по `created_at` в `runs.db`.
- [ ] `--union tag:<name>` объединяет run-ы с указанным тегом (run-level или suite-level).
- [ ] `--union runs:A,B[,C]` — explicit list, для compare-релизов.
- [ ] Help-text подробно отделяет `session` / `since` / `tag` / `runs` модификаторы и их семантику.
- [ ] JSON envelope несёт `union_mode` + список фактических `run_ids`.
<!-- SECTION:ACCEPTANCE:END -->
