---
id: TASK-142
title: 'zond request --validate-against <method> <path>'
status: To Do
assignee: []
labels:
  - request
  - validation
  - cli
milestone: m-8
dependencies: []
priority: medium
---

## Description

## Контекст

Источник: [m-8 feedback §G раунд 2](../notes/m-8-audit-cli-gaps/feedback-original.md).

`--validate-schema` есть на уровне `zond run`, но иногда хочется
прогнать **один** ad-hoc запрос и проверить тело против конкретного
response branch в spec. Сейчас — только встраивая в YAML.

## Что сделать

Опции для `zond request`:

1. `--validate-against <method> <path>` — явное указание endpoint'а из
   спеки `--api`.
2. `--api <name> --validate-schema` — авто-резолв endpoint'а по
   `method + URL.path` (с учётом base_url из env). Если URL не матчится
   ни одному endpoint'у — понятная ошибка с подсказкой `--validate-against`.
3. На выходе — секция «Schema validation: PASS / FAIL» с pointer'ами
   на нарушенные узлы (как в `zond run --validate-schema`).
4. Учитывать выбор response branch по фактическому status (200 → 200
   schema, 404 → 404 schema, default → default branch).

## Acceptance Criteria

- [ ] Оба варианта (`--validate-against`, `--api + --validate-schema`)
      работают.
- [ ] Авто-маппинг path → endpoint покрыт тестами (literal vs templated).
- [ ] При отсутствии match — понятная ошибка с подсказкой.
- [ ] Output показывает PASS/FAIL и JSON-pointer'ы.
- [ ] `--help` обновлён с примером.
- [ ] CHANGELOG.
