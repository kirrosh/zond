---
id: ARV-111
title: >-
  extend .api-resources.yaml: CLI для расширения custom-эндпоинтами (sha-tracked
  → edit'ы теряются на refresh-api)
status: To Do
assignee: []
created_date: '2026-05-11 09:20'
labels:
  - zond
  - cli
  - api-resources
  - fixtures
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Сейчас `.api-resources.yaml` хранит sha спецификации и при `refresh-api` перезатирается. Любые ручные правки (например, добавить write-only ingest-эндпоинт для harvest'а write-only ресурсов вроде Sentry's `POST /api/<project>/store/`) теряются.

Нужен CLI для extension'ов поверх spec'а, который:
- сохраняется отдельно от sha-tracked manifest (например, `.api-resources.local.yaml` или секция `extensions:` в самом manifest, не затираемая sha-check'ом)
- переживает `refresh-api`
- поддерживается `prepare-fixtures` и `harvest` (auto-call extension'ов для discovery vars, которые нельзя получить через spec)

Use-case: write-only ресурсы. Sentry создаёт `event_id`/`issue_id` только через SDK-style `POST /store/` endpoint, не описанный в OpenAPI. Без extension'а единственный путь — править `.env.yaml` руками, что zond skill сейчас запрещает.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 новый CLI: `zond api extend <api> --add-endpoint <path> --method POST --body <json>` (или эквивалент)
- [ ] #2 extension persisted в формате, переживающем `refresh-api`
- [ ] #3 `prepare-fixtures` подхватывает extension-эндпоинты для harvest'а
- [ ] #4 doc + skill: section про write-only ресурсы (Sentry-style ingest)
<!-- AC:END -->
