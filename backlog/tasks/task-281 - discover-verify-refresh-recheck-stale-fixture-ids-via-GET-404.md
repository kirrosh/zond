---
id: TASK-281
title: 'discover --verify / --refresh: пере-резолв stale fixture-id (GET → 404 → повторно открыть)'
status: To Do
assignee: []
created_date: '2026-05-08 19:00'
labels:
  - feedback-loop
  - api-sentry
  - discover
  - workspace-hygiene
dependencies:
  - TASK-259
  - TASK-273
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Source: feedback-14#F9, class workspace-hygiene + missing-feature.

`zond discover --apply` skipает уже set-нутые fixture-vars (`skip-already-set`), даже если их id давно протух — например, после `probe security`/`probe mass-assignment` ресурс был создан, удалён и id остался в `.env.yaml`. Следующий run валится 404 на каждом step'е, который использует stale FK.

TASK-259 (Done) добавил warning о live-state mutation. Нужен следующий шаг — actively re-validate.

Expected: новый флаг `discover --verify` (или `--refresh`):
1. Для каждого fixture-var с известным GET-by-id endpoint — отправить HEAD/GET; 200 → keep; 404/410 → unset + re-resolve через обычный discover-flow; 5xx → warn, keep (не trash при API-flake).
2. Без флага текущее поведение `skip-already-set` сохраняется.
3. `--verify --apply` без `--refresh` — только сообщает «N stale fixtures» без изменения файла; `--refresh` (или `--verify --apply --replace`) — реально перезаписывает.

Бонус: связь с TASK-278 (orphan list) — после `cleanup --orphans` автоматически приглашать `discover --verify`.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria

<!-- SECTION:ACCEPTANCE:BEGIN -->
- [ ] `discover --verify` HEAD/GET'ает каждую fixture с резолвимым `<resource>_id`/`<resource>_slug`, классифицирует как `live` / `stale` / `unknown`.
- [ ] `--verify` без `--apply` не пишет в `.env.yaml`; печатает компактный отчёт `N live, M stale, K unknown`.
- [ ] `--verify --apply` (или `--refresh`) для stale unset'ит и пробует re-resolve через основной discover-flow.
- [ ] 5xx на verify → классифицировать как `unknown`, не trashить (защита от flake).
- [ ] Verify на Sentry: после probe security удалить team вручную → `discover --verify` помечает её как stale; `--refresh` ставит новую.
- [ ] ZOND.md: коротко документирует stale-flow для probe-сессий.
<!-- SECTION:ACCEPTANCE:END -->
