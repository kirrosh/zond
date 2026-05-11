---
id: ARV-111
title: >-
  extend .api-resources.yaml: CLI для расширения custom-эндпоинтами (sha-tracked
  → edit'ы теряются на refresh-api)
status: Done
assignee: []
created_date: '2026-05-11 09:20'
updated_date: '2026-05-11 09:39'
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
- [x] #2 extension persisted в формате, переживающем `refresh-api`
- [ ] #3 `prepare-fixtures` подхватывает extension-эндпоинты для harvest'а
- [x] #4 doc + skill: section про write-only ресурсы (Sentry-style ingest)
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
MVP landed: persistence + merge.

Реализовано:
- Sibling-файл apis/<name>/.api-resources.local.yaml с top-level ключом 'extensions:' (массив записей формы ResourceYaml).
- readResourceMap() в discover.ts мерджит extensions в base resources: collision на 'resource' name → extension побеждает.
- readResourceExtensions() exported для тестов и downstream-консьюмеров.
- refresh-api не трогает .local.yaml — он рендерит только три файла (.api-catalog/.api-resources/.api-fixtures).
- bootstrap.ts: обновлены failure-reason'ы (failed:miss-empty-no-seed-owner/-endpoint) — теперь упоминают .api-resources.local.yaml как fallback.
- skill (zond-base.md): новая подсекция в Write-only с YAML-примером .api-resources.local.yaml.
- 7 новых юнит-тестов tests/cli/resource-extensions.test.ts + полный CLI-suite (368 тестов) проходит.

Deferred (открыт ARV-115):
- AC#1 — отдельный 'zond api extend' CLI. Пока юзер правит .api-resources.local.yaml через Write/Edit (consistent с ARV-114 policy).
- AC#3 — реальный --seed по extension'ам требует request-body-template поля. Сейчас extension виден prepare-fixtures'у, но trySeed() требует spec'ового requestBodySchema.
<!-- SECTION:NOTES:END -->
