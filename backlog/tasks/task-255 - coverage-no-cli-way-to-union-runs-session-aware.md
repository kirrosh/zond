---
id: TASK-255
title: 'coverage: нет CLI способа объединить runs (--session-id / --union отсутствуют), реальное покрытие невидимо'
status: To Do
assignee: []
created_date: '2026-05-08 14:30'
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
- [ ] Поддерживается хотя бы один из вариантов: `--session-id <id>`, `--session current`, `--union <run-id-list>`, `--union session`.
- [ ] При активной сессии (`.zond/current-session`) дефолт `coverage --api X` = union всех runs сессии (или явный hint, что нужен флаг).
- [ ] `coverage --help` содержит рецепт «как сложить tests + probes».
- [ ] Verify: tests-run + probes-run → coverage показывает 89% (196/219) на текущем sentry workdir, без `jq`-обходок.
<!-- SECTION:ACCEPTANCE:END -->
