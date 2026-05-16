---
id: TASK-278
title: 'probe security orphans: перечислить id/URL + команда `zond cleanup --orphans`'
status: Done
assignee: []
created_date: '2026-05-08 19:00'
updated_date: '2026-05-08 14:27'
labels:
  - feedback-loop
  - api-sentry
  - probe
  - cleanup
  - workspace-hygiene
dependencies:
  - TASK-259
  - TASK-264
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Source: feedback-14#F5, class workspace-hygiene + missing-feature.

После `zond probe security` reporter пишет:
```
Warning: 4 orphan resource(s): cleanup DELETE failed (non-404). Manual remediation may be needed
```

Без перечисления, какие именно ресурсы остались. На Sentry это создало мусор: тестовые teams, keys, symbol-sources, user-feedback в реальном workspace. Чтобы найти их вручную, надо листать каждый list-endpoint и матчить по timestamp/префиксу — ~20 минут на чистку.

Связь:
- TASK-259 (Done) — добавил warning + recovery про stale FK после probe-mutation, но orphan-list не выводит.
- TASK-264 (To Do) — `--isolated` namespace решит проблему **на будущее**, но не помогает с уже накопленным мусором + не для каждого target есть namespacing.

Expected:
1. После cleanup-failure warning перечисляет orphan-ы: `POST /api/.../teams/ → 201 (slug=zond-probe-x7q3, id=42); DELETE /api/.../teams/zond-probe-x7q3/ → 500 (still alive)`.
2. Persist orphan-list в `~/.zond/orphans/<api>/<run-id>.jsonl` с created_at/method/path/id/last_cleanup_status.
3. Команда `zond cleanup --orphans [--api <name>] [--run <id>]`:
   - читает orphan-files, retry DELETE, помечает в файле успех/неудачу.
   - `--dry-run` показывает план без выполнения.
   - 404 на retry → считается успехом (уже удалено), запись removed.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
<!-- SECTION:ACCEPTANCE:BEGIN -->
- [ ] #1 Probe-runtime пишет orphan-список в `~/.zond/orphans/<api>/<run-id>.jsonl` для **всех** созданных ресурсов (не только тех, чьё DELETE упало) — на случай аборта по Ctrl-C / процесс-крэша.
- [ ] #2 Reporter после probe-run в случае cleanup-failure печатает компактную таблицу orphan-ов (method/path/id) + строку `Run \`zond cleanup --orphans --api <name>\` to retry`.
- [ ] #3 CLI: `zond cleanup --orphans` поддерживает фильтры `--api` / `--run` / `--dry-run`; идемпотентен; 404 трактуется как success.
- [ ] #4 Verify на Sentry: после probe security 4 orphan-ресурса видны списком, `zond cleanup --orphans` подчищает 0/4 → 4/4 (ну или показывает причину 5xx).
- [ ] #5 ZOND.md: секция «Orphan resources & cleanup» с примером.
<!-- SECTION:ACCEPTANCE:END -->
<!-- AC:END -->
