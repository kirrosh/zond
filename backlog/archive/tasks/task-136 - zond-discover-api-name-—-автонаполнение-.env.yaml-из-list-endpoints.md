---
id: TASK-136
title: zond discover --api <name> — автонаполнение .env.yaml из list-endpoints
status: Done
assignee: []
created_date: ''
updated_date: '2026-05-05 12:40'
labels:
  - cli
  - discovery
  - fixtures
milestone: m-8
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Контекст

Источник: [m-8 feedback §3 раунд 2](../notes/m-8-audit-cli-gaps/feedback-original.md).

Phase 2.5 в скилле говорит «дополни `.env.yaml` реальными id». В Sentry
это значило вручную сделать `zond request GET /organizations/`,
`/projects/`, `/members/`, выловить slug'и и руками вписать в env. Это
повторяется на каждом новом API и стоит ~15 минут. При том что вся
информация уже есть в `.api-resources.yaml` (list-endpoints) + auth-token.

## Что сделать

Команда: `zond discover --api <name> [--auth <env-var>] [--apply|--dry-run]`.

1. Читает `.api-resources.yaml` и/или `.api-catalog.yaml`, отбирает
   list-endpoints (по эвристике: `GET /<resources>` без path-параметров,
   возвращающий массив).
2. Запускает реальные запросы (с rate-limit auto), извлекает первый id
   каждого ресурса (`id`/`slug`/`uuid`/`name` — настраиваемая стратегия).
3. Маппит id на переменные `.env.yaml` по совпадению имён path-params в
   спеке (`organization_id_or_slug`, `project_id_or_slug`, `team_slug` и т.п.).
4. По умолчанию `--dry-run`: показывает diff (что бы добавилось/изменилось),
   ничего не пишет. Под `--apply` — записывает в `.env.yaml` с бэкапом.
5. Логирует, какие endpoints не вернули данных / отдали 4xx (auth-scope
   gap), и подсказывает в выводе.
6. Уважает `--rate-limit auto`.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Команда зарегистрирована в CLI, описана в `ZOND.md`.
- [ ] #2 `--dry-run` (default) и `--apply` работают, бэкап `.env.yaml.bak`
      при apply.
- [ ] #3 Выбор стратегии id (`--prefer slug,id,uuid`).
- [ ] #4 Авторизация — реюз существующего env-var механизма (`--auth` /
      `auth_token` в `.env.yaml`).
- [ ] #5 Тесты на маппинг path-param → env-key и на dry-run/apply.
- [ ] #6 Скилл-секция «Phase 2.5 fixture pack» обновлена: вместо ручных
      `zond request` — `zond discover`.
- [ ] #7 CHANGELOG.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
MVP: zond discover --api <name> [--apply]. Читает .api-resources.yaml, для каждой path-FK var с известным ownerResource хитит owner.endpoints.list, экстрактит первое значение (suffix-aware: *_slug→slug, *_uuid→uuid, *_id→id, fallbacks), пишет diff в stdout/JSON. --apply делает .env.yaml.bak бэкап и upsert через regex-замену. Скипает уже заполненные не-плейсхолдеры. v1 ограничение: только collection-level list endpoints (no nested). 4 unit-теста с Bun.serve мок-сервером. Скилл Phase 2.5 обновлён, CHANGELOG, ZOND.md.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
TASK-136: zond discover MVP. Автонаполнение .env.yaml из list-endpoints, suffix-aware extraction, --apply с бэкапом. v1 не покрывает nested list-paths — отмечено для TASK-137. 940/940 тестов.
<!-- SECTION:FINAL_SUMMARY:END -->
