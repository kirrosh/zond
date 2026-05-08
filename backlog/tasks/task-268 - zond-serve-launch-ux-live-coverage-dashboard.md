---
id: TASK-268
title: 'zond serve: запускаемость + live coverage/run-history dashboard (--open)'
status: To Do
assignee: []
created_date: '2026-05-08 15:00'
labels:
  - feedback-loop
  - ui
  - serve
  - ux
dependencies: []
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Source: feedback-12 impressions, "Workflow-level" #8.

Цитата тестера: «Live UI dashboard (`zond serve`) — оно есть, но я ни разу не смог запустить. Если бы `zond serve --open` поднял веб-интерфейс с live-graph покрытия + run-history, тестировщику стало бы намного легче понимать что происходит.»

Двойная боль:
1. **Запускаемость**: `zond serve` либо падает, либо не открывает порт, либо не печатает URL. Нужно проверить failure modes и выводить чёткий error/URL.
2. **Содержательность**: даже если запускается, dashboard минимален. Что просит тестер:
   - live coverage graph (по тегам, по methods, timeline по runs);
   - run-history с фильтром (api/tag/status/since);
   - ссылка на `db diagnose` для конкретного failing run;
   - реакция в реальном времени, пока `zond run` идёт в другом терминале.

Связано: TASK-103 (src/web → src/ui prod migration), TASK-108 (interactive replay), TASK-109 (coverage map UI). Возможно, этот таск — зонтик + acceptance smoke над теми тремя.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria

<!-- SECTION:ACCEPTANCE:BEGIN -->
- [ ] `zond serve` стабильно запускается из чистого workspace; печатает URL и порт.
- [ ] `zond serve --open` автоматически открывает дефолтный браузер.
- [ ] Failure modes (busy port, missing build artifact) → ясное сообщение + recovery hint.
- [ ] Dashboard показывает: live coverage по api+tag, run-history, last 5xx/security HIGH summary.
- [ ] Dashboard обновляется в real-time, пока `zond run` пишет в DB.
- [ ] Verify: `zond audit --api sentry` (TASK-262) + `zond serve --open` параллельно → видно прогресс runs и coverage без F5.
<!-- SECTION:ACCEPTANCE:END -->
