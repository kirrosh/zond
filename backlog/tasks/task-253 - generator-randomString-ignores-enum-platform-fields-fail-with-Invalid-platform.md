---
id: TASK-253
title: 'generator: {{$randomString}} игнорирует enum:/x-platform — platform-поле сыпет 400 Invalid platform'
status: Done
assignee: []
created_date: '2026-05-08 14:00'
labels:
  - feedback-loop
  - api-sentry
  - generator
  - data-factory
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Source: feedback-11#F2, class missing-feature.

Generator не подхватывает `enum:` и x-extension-словари (типа `x-platform-list`) → `platform: "gMbpJg8e"` для project create → 400 `Invalid platform`.

Repro:
```
zond run apis/sentry/tests/crud-projects.yaml --report json --report-out /tmp/x.json
jq '.[].steps[]|select(.name=="Create a New Project")|{body: .request.body, err: .response.body}' /tmp/x.json
# body: {..."platform":"gMbpJg8e",...}
# resp: "platform":["Invalid platform"]
```

Sentry внутри валидирует поле `platform` против списка ~70 platform-id-ов (`python`, `javascript-react`, …). Spec формально type=string без enum, но описание поля и x-расширения часто несут эту информацию.

Expected (приоритет в порядке fallback):
1. Если в schema есть `enum:` — выбираем рандомное значение из enum.
2. Если есть `example`/`examples` — используем их (уже частично есть).
3. Эвристика на имя поля (`platform`, `language`, `country`, `timezone`) → справочник дефолтных значений (`python`, `en`, `US`, `UTC`).
4. Иначе fallback на текущий `$randomString`.

Actual: random string → 400. Создание любого project в Sentry падает.

Связано с TASK-252: общий root — generator value-генерации не использует constraints.

Log: /tmp/zond-fb/sentry/rounds/raw-11.log
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria

<!-- SECTION:ACCEPTANCE:BEGIN -->
- [ ] При наличии `enum:` в string-схеме generator выбирает значение из списка.
- [ ] Эвристика по имени поля для `platform`/`language`/`country`/`timezone` (минимальный словарь дефолтов).
- [ ] Verify: `zond generate --api sentry --tag Projects` → `crud-projects.yaml` body для `POST /projects/` с `platform` из словаря (`python`). `zond run` → 201 без 400 на platform.
- [ ] Tests: `data-factory.test.ts` покрывает enum-path и name-heuristic (positive + negative — не подменять, если spec явно даёт другое).
<!-- SECTION:ACCEPTANCE:END -->
