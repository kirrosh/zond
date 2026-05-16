---
id: TASK-246
title: 'generator: CRUD-chain detector не находит item-path при flat-create + nested-item routing (POST /teams/ vs item /teams/{org}/{team}/)'
status: Done
assignee: []
created_date: '2026-05-08 13:00'
updated_date: '2026-05-08 13:50'
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
- [x] CRUD detector fallback: item-path matched когда `<basePath>/{id}` regex не сработал, но есть endpoint с тем же tag и terminal `{param}` равным singular(resource)/`<sg>_id`/`<sg>_id_or_slug`/`<sg>_slug`.
- [x] Используется и tags-сигнал, и param-name эвристика — оба должны совпадать (минимум ложных срабатываний).
- [x] Verify Sentry: `zond generate --api sentry --explain | grep '^teams'` → `chain    POST + GET/{id} matched` (было `skipped`).
- [x] CRUD detection rate: было 14/31, стало 17/31 (+3 family — teams, плюс ещё две).

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
- `src/core/generator/suite-generator.ts:detectCrudGroupsWithDiagnostics`: после первичного `itemPattern` regex'а добавлен fallback по shared tag + terminal-param-name match.
- Singular formы покрыты через `singularizeResource(resource).toLowerCase()`. Для `teams` → `team`, матчит `{team}` / `{team_id_or_slug}`.
- itemPath берётся из `resolvedItemEndpoints[0]` — ровно один путь после fallback'а.
<!-- SECTION:NOTES:END -->
<!-- SECTION:ACCEPTANCE:END -->
