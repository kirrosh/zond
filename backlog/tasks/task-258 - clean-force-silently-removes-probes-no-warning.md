---
id: TASK-258
title: 'clean: `--api X --force` тихо сносит apis/<name>/probes/, пользователь теряет суиты без warning'
status: To Do
assignee: []
created_date: '2026-05-08 14:30'
labels:
  - feedback-loop
  - api-sentry
  - cli
  - ux
dependencies: []
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Source: feedback-12#F4, class ux-papercut.

`zond clean --api sentry --force` помимо ожидаемого удаляет также всю папку `apis/sentry/probes/` без warning'а. После этого `zond run apis/sentry/probes` падает с `No test files found`, и пользователь должен помнить, что probe-pipeline отдельный и его надо регенерировать через `zond probe-validation/-methods --api sentry` (~30 сек на 219-эндпоинтовом spec'е).

Repro:
```
zond clean --api sentry --force      # удаляет (помимо ожидаемого) все probes/*.yaml
zond run apis/sentry/probes          # → "Warning: No test files found in apis/sentry/probes"
zond probe-validation --api sentry --output apis/sentry/probes  # → нужно регенерировать
```

Расширение feedback-04#F1 (там фикс был для spec.json, но не для probes).

Expected (любой из):
- по умолчанию `clean --force` НЕ трогает `probes/` (отдельный pipeline), нужен явный `--probes`;
- либо при удалении probes печатать `removed N probe-suites; regenerate via zond probe-validation/-methods --api X`.

Actual: silent removal, никакого hint.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria

<!-- SECTION:ACCEPTANCE:BEGIN -->
- [ ] `clean --api X --force` либо не удаляет `probes/` по умолчанию, либо печатает явный warning с командой регенерации.
- [ ] Решение задокументировано в `clean --help`.
- [ ] Verify: после `zond clean --api sentry --force` пользователь видит чёткий путь восстановления probes.
<!-- SECTION:ACCEPTANCE:END -->
