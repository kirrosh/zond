---
id: TASK-139
title: 'zond generate: ослабить CRUD-эвристику + --explain'
status: To Do
assignee: []
labels:
  - generate
  - crud
  - recall
milestone: m-8
dependencies: []
priority: high
---

## Description

## Контекст

Источник: [m-8 feedback §C раунд 2](../notes/m-8-audit-cli-gaps/feedback-original.md).

`zond generate` на спеке Sentry (219 endpoints) сделал только 2 CRUD-suite
(Groups, Users — оба SCIM, оба требуют Enterprise-план). Десятки реальных
CRUD-ресурсов (alert-rules, dashboards, monitors, releases) не попали в
чейны. Гипотеза: detector ищет строгую форму `POST /<r>` + `GET /<r>/{id}`
+ `DELETE /<r>/{id}`, тогда как Sentry часто использует `POST /<r>/`
(slash) или возвращает body без явного `id` (а `slug` / `version` /
`uuid`).

## Что сделать

1. **Ослабить эвристику CRUD-detector'а:**
   - Считать `POST /<r>` и `POST /<r>/` (со slash) эквивалентными.
   - Если `POST` возвращает body с любым полем, похожим на id (`id`,
     `uuid`, `slug`, `version`, `key`, `name`), И есть `DELETE` с
     каким-либо path-параметром на том же корне — считать chain-кандидатом.
   - Path-параметр `DELETE` маппить на найденное id-поле эвристически
     (по совпадению имён `{slug}` ↔ `slug`, `{id}` ↔ `id`, и т.п.).
2. **`zond generate --explain [--api <name>]`** — диагностический режим:
   для каждого ресурса показать, что было рассмотрено и почему отвергнуто
   (нет POST, нет DELETE, не нашли id-поле в response, missing schema...).
   Формат: таблица с колонками `resource | post | get-by-id | delete |
   verdict | reason`.
3. Покрыть тестами кейсы Sentry-подобной формы (POST со slash, response
   с `slug` вместо `id`).

## Acceptance Criteria

- [ ] CRUD-detector принимает `POST /<r>/` и распознаёт id-подобные поля
      (`id|uuid|slug|version|key|name`).
- [ ] `zond generate --explain` показывает per-resource verdict и причину.
- [ ] На fixture-спеке с Sentry-подобной формой (alert-rules, dashboards)
      генерируется CRUD-suite, где раньше генерировалось 0.
- [ ] Не регрессирует на классических OpenAPI-спеках (тест на
      `petstore.json`).
- [ ] CHANGELOG.
