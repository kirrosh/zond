---
id: TASK-246
title: 'generator: CRUD-chain detector не находит item-path при flat-create + nested-item routing (POST /teams/ vs item /teams/{org}/{team}/)'
status: To Do
assignee: []
created_date: '2026-05-08 13:00'
labels:
  - feedback-loop
  - api-sentry
  - generator
  - crud
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Source: feedback-09#F4, re-confirmed feedback-10 (NOT fixed), class missing-feature.

Repro:
```
zond generate --api sentry --explain | grep -E "team"
# teams /api/0/organizations/{org}/teams/   skipped  no item endpoint matching .../teams/{...}
```
Реально `POST /api/0/organizations/{org}/teams/` создаёт team (verified 201), а item-path лежит по другому корню — `/api/0/teams/{org}/{team}/`. Sentry-style "subdomain"/nested routing.

Expected: chain-detector ищет item-эндпоинт не только в `<basePath>/{id}/`, но и:
- по `tags` (operation.tags пересечение);
- по path-param-name match (`{team_id_or_slug}` встречается в `/teams/{org}/{team}/...`);
- опц. через `x-resource-class`/extension.

Actual: 3 family skipped в explain (teams + связанные).

Связано с TASK-238 (FK-owner resolution через URL graph) — но там про path-fixture chain, а здесь про item-endpoint discovery для CRUD-suite emission.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria

<!-- SECTION:ACCEPTANCE:BEGIN -->
- [ ] CRUD detector матчит item-path по path-param-name из create-response (не только по prefix).
- [ ] Дополнительный сигнал: `tags` operation совпадают.
- [ ] Verify: `zond generate --api sentry --explain | grep -E '^teams'` → НЕ `skipped` (есть chain).
- [ ] `crud-teams.yaml` сгенерирован с POST /teams/ + GET/PATCH/DELETE по nested item-path.
<!-- SECTION:ACCEPTANCE:END -->
