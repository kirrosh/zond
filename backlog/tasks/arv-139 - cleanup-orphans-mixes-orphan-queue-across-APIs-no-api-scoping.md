---
id: ARV-139
title: cleanup --orphans mixes orphan-queue across APIs (no --api scoping)
status: Done
assignee: []
created_date: '2026-05-11 20:35'
updated_date: '2026-05-11 20:49'
labels:
  - bug
  - cleanup
  - session-isolation
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Sentry round-01 fb-loop: после работы с apis/resend/ (включая `PATCH /templates/{id}`) переключился на sentry; `zond cleanup --orphans` всё ещё печатает `PATCH /templates/{id} — cleanup skipped: no DELETE plan`. Queue в ~/.zond/orphans/ (TASK-278) глобальна на workspace, не фильтруется по active API. Cleanup тыкает DELETE в endpoint'ы несуществующего активного API → шум + потенциально ошибочные действия при переключении API обратно. Тот же класс что ARV-71 (session-isolation). Источник: ~/Projects/zond-test/.fb-loop/rounds/feedback-01.md F3.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 `zond cleanup --orphans` фильтрует queue по active API (current-session) по умолчанию
- [ ] #2 `zond cleanup --orphans --api <name>` явно скоупит на указанный API
- [ ] #3 `zond cleanup --orphans --all-apis` сохраняет старое поведение (явный opt-in)
<!-- AC:END -->
