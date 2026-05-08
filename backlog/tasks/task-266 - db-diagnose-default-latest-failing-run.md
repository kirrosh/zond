---
id: TASK-266
title: 'zond db diagnose: без аргумента — последний failing run (вместо ручного `db runs | head`)'
status: To Do
assignee: []
created_date: '2026-05-08 15:00'
labels:
  - feedback-loop
  - cli
  - ux
dependencies: []
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Source: feedback-12 impressions, "QoL" #2.

Сейчас `zond db diagnose` требует `--run-id N`. Чтобы найти его, тестер делает `zond db runs | head -1` и копирует ID. На сессии в десятки run'ов это сотни лишних команд.

Цель: `zond db diagnose` без аргумента = последний failing run (priority: failed > error > timeout > pass). `--latest` (любой последний) и `--run-id N` (как раньше) — флаги.

Также: `zond db diagnose --watch` — поллит каждые N секунд и переключается на новый failing run, если появился. (Опциональный bonus для watch-loop'ов.)
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria

<!-- SECTION:ACCEPTANCE:BEGIN -->
- [ ] `zond db diagnose` без аргументов = последний failing run; если все pass → последний run + сообщение «no failures».
- [ ] `--latest` = последний run независимо от статуса.
- [ ] `--run-id N` сохраняется как explicit override.
- [ ] `--help` явно описывает default behaviour.
- [ ] Verify: после неудачного run'а `zond db diagnose` сразу показывает диагностику без ручного поиска ID.
<!-- SECTION:ACCEPTANCE:END -->
