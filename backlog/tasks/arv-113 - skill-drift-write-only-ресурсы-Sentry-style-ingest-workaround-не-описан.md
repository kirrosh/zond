---
id: ARV-113
title: 'skill drift: write-only ресурсы / Sentry-style ingest workaround не описан'
status: To Do
assignee: []
created_date: '2026-05-11 09:20'
labels:
  - zond
  - skill-drift
  - fixtures
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Skill (zond.md / zond-base.md / prepare-fixtures docs) сейчас полагает, что все ресурсы можно либо найти через `GET /list/`, либо создать через `--seed` (POST по спеке). Это не покрывает write-only ресурсы, у которых:
- нет GET-list-эндпоинта (`event_id`, `replay_id` в Sentry)
- нет описания POST в OpenAPI (создаются через SDK-style `POST /api/<project>/store/` с public DSN-ключом в заголовке `X-Sentry-Auth`)

Skill должен:
1. Назвать класс таких ресурсов явно ("write-only / SDK-only").
2. Описать workaround: `zond request <bare-ingest-url>` с custom-заголовком → distill в `.env.yaml`.
3. Указать на known dead-end: некоторые ресурсы (например, Sentry `POST /monitors/`) возвращают 400 на любой формат project — это не zond-баг, в backlog не идёт, в skill — footer "known dead-ends".
4. Связать с ARV-XXX (F18) на момент, когда extension API подъедет — пока он не готов, ручной workaround остаётся валидным.

Reason: в раунде 4 пользователь повторил один и тот же workaround (Sentry ingest) — это не one-off, это паттерн для целой категории API.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 новая секция в zond-base.md / prepare-fixtures.md: "write-only / SDK-only ресурсы"
- [ ] #2 пример Sentry ingest workaround (без хардкода DSN — placeholder)
- [ ] #3 footer "known dead-ends" в skill, чтобы агент не зацикливался
- [ ] #4 cross-ref на F18-таск (extend .api-resources)
<!-- AC:END -->
