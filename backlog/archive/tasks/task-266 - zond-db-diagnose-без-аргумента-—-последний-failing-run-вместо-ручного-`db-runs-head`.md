---
id: TASK-266
title: >-
  zond db diagnose: без аргумента — последний failing run (вместо ручного `db
  runs | head`)
status: Done
assignee: []
created_date: '2026-05-08 15:00'
updated_date: '2026-05-09 09:17'
labels:
  - feedback-loop
  - cli
  - ux
milestone: m-14
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Source: feedback-12 impressions, "QoL" #2.

Сейчас `zond db diagnose` требует `--run-id N`. Чтобы найти его, тестер делает `zond db runs | head -1` и копирует ID. На сессии в десятки run'ов это сотни лишних команд.

Цель: `zond db diagnose` без аргумента = последний failing run (priority: failed > error > timeout > pass). `--latest` (любой последний) и `--run-id N` (как раньше) — флаги.

Также: `zond db diagnose --watch` — поллит каждые N секунд и переключается на новый failing run, если появился. (Опциональный bonus для watch-loop'ов.)
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
<!-- SECTION:ACCEPTANCE:BEGIN -->
- [ ] #1 `zond db diagnose` без аргументов = последний failing run; если все pass → последний run + сообщение «no failures».
- [ ] #2 `--latest` = последний run независимо от статуса.
- [ ] #3 `--run-id N` сохраняется как explicit override.
- [ ] #4 `--help` явно описывает default behaviour.
- [ ] #5 Verify: после неудачного run'а `zond db diagnose` сразу показывает диагностику без ручного поиска ID.
<!-- SECTION:ACCEPTANCE:END -->
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Fix: zond db diagnose без аргумента → последний failing run (priority failed > pass). Добавлены флаги --latest (любой последний run) и --run-id N (явный override, для агентов). Если ни один run не упал — fallback на последний run с warning 'No failing runs'. Если БД пуста — exit 1 + понятное сообщение. JSON envelope теперь содержит data.run_id и data.resolution. Tests in tests/cli/db.test.ts.
<!-- SECTION:NOTES:END -->
