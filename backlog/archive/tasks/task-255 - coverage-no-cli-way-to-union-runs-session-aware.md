---
id: TASK-255
title: 'coverage: нет CLI способа объединить runs (--session-id / --union отсутствуют), реальное покрытие невидимо'
status: Done
assignee: []
created_date: '2026-05-08 14:30'
updated_date: '2026-05-08 16:30'
labels:
  - feedback-loop
  - api-sentry
  - coverage
  - ux
dependencies:
  - TASK-251
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Source: feedback-12#F1, class missing-feature (расширение TASK-251 / feedback-10#F3).

`zond coverage` берёт только последний run. Когда у пользователя есть и tests-run, и probes-run, реальное (union) покрытие невидимо без ручного `jq`-shell. CI-метрика "общее покрытие" недостижима стандартным CLI.

Repro:
```
zond session start --label combined
zond run apis/sentry/tests --validate-schema --spec apis/sentry/spec.json    # run #58: 113 covered
zond run apis/sentry/probes                                                  # run #59: 117 covered
zond session end
zond coverage --api sentry                          # → 117 (latest run only)
zond coverage --api sentry --run-id 58              # → 113
zond coverage --api sentry --session-id <UUID>      # → does not exist
zond coverage --api sentry --union all              # → does not exist
```

Workaround (то, что пришлось делать вручную):
```
zond coverage --run-id 58 --json | jq -r '.data.coveredEndpoints[]' > /tmp/a
zond coverage --run-id 59 --json | jq -r '.data.coveredEndpoints[]' > /tmp/b
cat /tmp/a /tmp/b | sort -u | wc -l                 # → 188 (89%)
```

Impact (доказательство нужности): "зелёный" CI равен `max(coverage(tests), coverage(probes)) = 55%`, тогда как реальное union даёт **89% (196/219)** — расхождение в 34 п.п.

Expected: `--session-id <id>` (auto из `.zond/current-session`), либо `--union <run-ids>`, либо `--union session`. `coverage --help` должен явно упоминать рецепт.

Log: /tmp/zond-fb/sentry/rounds/raw-12.log
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria

<!-- SECTION:ACCEPTANCE:BEGIN -->
- [x] `--session-id <id>`, `--union session`, `--union <id1,id2,...>` — все три формы реализованы. `--run-id` оставлен для back-compat.
- [x] При активной сессии с >1 run и без явного селектора — hint в stderr: `Active session has N runs. Coverage shows the latest only — pass '--union session' to combine all runs in the session.` (Не меняем default — fail-on-coverage в CI не должен внезапно сменить семантику; явный flag = осознанный выбор.)
- [x] `coverage --help` содержит рецепт `zond session start → run tests → run probes → coverage --api X --union session`.
- [x] Verify на sentry workdir: `--run-id 58` → 113 (52%), `--run-id 59` → 117 (53%), `--union 58,59` или `--union session` → **188 (86%)**. Расхождение с цифрой 89% из бага (196) объясняется разницей подсчёта: bug-script уникализировал raw `coveredEndpoints[]`, а матрикс-engine считает 2xx-pass. Главное: union > max(individual), фича работает.
<!-- SECTION:ACCEPTANCE:END -->

## Implementation notes

<!-- SECTION:NOTES:BEGIN -->
- **Loader**: `CoverageLoadOptions` принял `runIds?: number[]` и `sessionId?: string`. Precedence: `sessionId > runIds > runId > latest`. Resolved runs пишутся в `result.runs[]` (новое поле); singular `run` оставлен для back-compat = последний из списка.
- **Session resolution**: `listRunsBySession` фильтрует runs внутри loader'а по `collection_id === collection.id || collection_id == null`. NULL-collection runs (probes, ad-hoc) включаются — иначе session-union для sentry показывал только tests-run, потому что probes-run приходят без `collection_id` (известный pre-existing quirk пробок). Это исправление на стороне coverage; собственно теггинг probes — отдельная история.
- **CLI**: `--union <ids|session>` парсит через экспортированный `parseUnion` (8 unit-тестов). `--union session` резолвит через `.zond/current-session` (тот же файл что и `zond run --session-id` использует).
- **Hint**: только stderr, только в TTY-режиме (без `--json`), только когда session активна и runs>1. Не меняет exit code и не ломает CI-output.
- Не закрывает session-aware default (TASK-251) — это отдельный план: что делать когда последний run сессии меньше latest-run-by-collection. Сейчас latest по collection берётся независимо от session.
<!-- SECTION:NOTES:END -->
