---
id: TASK-260
title: 'chain detector: пропускает headless chains (POST + DELETE без GET-by-id) — слишком жёсткий минимум'
status: To Do
assignee: []
created_date: '2026-05-08 14:30'
labels:
  - feedback-loop
  - api-sentry
  - chain-detector
  - generator
dependencies:
  - TASK-246
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Source: feedback-12#F6, class missing-feature (продолжение TASK-246).

Chain detector требует минимум `POST + GET/{id}`, поэтому ресурсы с layout `list + POST + DELETE/{id}` (или `list + POST + PUT/{id} + DELETE/{id}` без GET-by-id) skipped. Пример Sentry: `/api/0/teams/{org}/{team}/external-teams/` — есть list (`GET /external-teams/`), POST, и `/external-teams/{external_team_id}/` с PUT/DELETE, но нет GET-by-id. Detector пишет `skipped: item endpoint exists but no GET-by-id`.

Repro:
```
zond generate --api sentry --explain | grep external-teams
# external-teams /api/0/teams/{org}/{team}/external-teams/   skipped  item endpoint exists but no GET-by-id
```

Expected: detector понимает, что для headless chains достаточно `POST + DELETE/{id}` (или `POST + PUT/{id}`) — captured ID берётся из POST-response (см. TASK-256 для capture flow). Альтернатива — флаг `--allow-headless-chain` для opt-in.

Actual: жёсткий минимум, ресурсы с такой формой роутинга невидимы для CRUD-генератора.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria

<!-- SECTION:ACCEPTANCE:BEGIN -->
- [ ] Chain detector принимает headless chain `POST + DELETE/{id}` (минимум) и `POST + PUT/{id}` без GET-by-id.
- [ ] ID для последующих steps берётся из POST-response (через capture; зависимость с TASK-256).
- [ ] Если поведение opt-in — есть флаг или setting; иначе — поведение по умолчанию.
- [ ] Verify: `zond generate --api sentry --tag Teams` → `crud-external-teams.yaml` сгенерирован, `--explain` уже не пишет skipped для external-teams.
<!-- SECTION:ACCEPTANCE:END -->
