---
id: TASK-274
title: 'coverage --union: по time-window и tag, не только session'
status: Done
assignee: []
created_date: '2026-05-08 18:00'
updated_date: '2026-05-08 19:30'
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
- [x] `--union since:<dur>` поддерживает `1h`/`24h`/`7d`/`30m`-формат, фильтрует по `runs.started_at` одним SQL-`WHERE` (без повторного прогона).
- [x] `--union tag:<name>` объединяет run-ы с указанным тегом — теги пишутся при `zond run` (объединение `suite.tags` + `--tag`-фильтра) в новую колонку `runs.tags`.
- [x] `--union runs:A,B[,C]` — explicit list (плюс back-compat без префикса `runs:`).
- [x] Help-text подробно отделяет `session` / `since` / `tag` / `runs` модификаторы и их семантику + recipe в одном блоке.
- [x] JSON envelope несёт `union_mode` (`session|since|tag|runs|null`) + `runIds`.
<!-- SECTION:ACCEPTANCE:END -->

## Implementation notes

<!-- SECTION:NOTES:BEGIN -->
- **Schema migration v8→v9** добавила колонку `runs.tags` (JSON-массив строк). Для legacy-строк значение `NULL`; для новых run-ов в `zond run` пишется объединение `suite.tags` всех выполненных suites + значений `--tag`-фильтра (отсортированный, дедуплицированный список).
- **Loader precedence**: `sessionId > sinceIso > tag > runIds > runId > latest`. `since:`/`tag:` фильтруются по `collection_id` (без NULL-collection — пользователь явно указал API; ad-hoc/probe-runs должны быть тегированы или захвачены через `--union session`). `sinceIso` пробрасывается как ISO-таймстамп; CLI считает `now - dur` в момент вызова, чтобы лоадер оставался безсайдэффектным.
- **CLI parser**: `parseUnion` теперь возвращает discriminated union `{ kind: "session" | "since" | "tag" | "runs"; ... }`; экспортирован `parseDuration` (s/m/h/d). 13 дополнительных unit-тестов в `tests/cli/coverage-union.test.ts`.
- **DB query**: новый `listRunsByCollectionFiltered(colId, { since?, tag? })` — один SELECT с `WHERE`-клауз; для `tag:` использует `LIKE '%"<name>"%'` поверх JSON-строки (точное совпадение элемента, без false-positive на подстроке — проверено тестом). Для текущего масштаба (десятки run-ов на коллекцию) JSON1 overkill.
- **JSON envelope**: добавлены `union_mode` (string|null) и `runIds: number[]`. Совместимость со старым `runId: cov.run?.id ?? null` сохранена.
- **Empty-match UX**: при `--union <selector>` без матчей TTY-ветка теперь печатает `no runs match --union <mode>` вместо вводящего в заблуждение `no runs yet`.
- **Verify** на sentry workdir: `--union since:24h` → 27 run-ов (#1, #15…#80), 93% (204/219); `--union runs:79,80` ≡ legacy `--union 79,80` → 91% (200/219); `--union tag:smoke` на legacy-данных без тегов → "no runs match" (ожидаемо, новые run-ы будут попадать).
<!-- SECTION:NOTES:END -->
