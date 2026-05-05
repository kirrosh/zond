---
id: TASK-136
title: 'zond discover --api <name> — автонаполнение .env.yaml из list-endpoints'
status: To Do
assignee: []
labels:
  - cli
  - discovery
  - fixtures
milestone: m-8
dependencies: []
priority: high
---

## Description

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

## Acceptance Criteria

- [ ] Команда зарегистрирована в CLI, описана в `ZOND.md`.
- [ ] `--dry-run` (default) и `--apply` работают, бэкап `.env.yaml.bak`
      при apply.
- [ ] Выбор стратегии id (`--prefer slug,id,uuid`).
- [ ] Авторизация — реюз существующего env-var механизма (`--auth` /
      `auth_token` в `.env.yaml`).
- [ ] Тесты на маппинг path-param → env-key и на dry-run/apply.
- [ ] Скилл-секция «Phase 2.5 fixture pack» обновлена: вместо ручных
      `zond request` — `zond discover`.
- [ ] CHANGELOG.
