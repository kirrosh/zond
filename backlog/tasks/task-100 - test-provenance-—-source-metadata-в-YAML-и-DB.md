---
id: TASK-100
title: test provenance — source metadata в YAML и DB
status: Done
assignee: []
created_date: '2026-04-30 09:35'
updated_date: '2026-04-30 10:00'
labels:
  - trust-loop
  - decision-5
  - data
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Контекст

decision-5 сделал `zond serve` равноправным trust surface. Без provenance
UI не сможет ответить «откуда этот тест и что он покрывает» — ключевой
вопрос trust loop.

## Что добавляем

Optional блок `source:` на уровне suite и step в YAML + соответствующее
поле в `results.provenance` (DB) для probe-классов, которые
runtime-генерируют step-ы без YAML на диске.

### Suite-level (когда suite сгенерирован целиком)

```yaml
source:
  type: openapi-generated   # | manual | probe-suite
  spec: openapi.yaml         # путь относительно workspace root
  generator: zond-generate
  generated_at: "2026-04-30T12:00:00Z"
```

### Step-level (наследует от suite, может перекрыть)

```yaml
- name: ...
  source:
    endpoint: "POST /webhooks"
    response_branch: "422"
    schema_pointer: "#/paths/~1webhooks/post/responses/422"
    generator: negative-probe   # опционально, если step добавлен probe-ом
```

## Не-требования

- Manual YAML без `source:` остаётся 100% валидным. UI рендерит как
  «manually authored».
- `source:` НЕ участвует в matching / dedup / validation. Это
  чисто metadata.

## Где меняется код

- `src/core/parser/yaml-parser.ts` — accept optional `source:` поле,
  пропускать в parsed AST без валидации содержимого (just a record).
- `src/core/generator/suite-generator.ts` — emit suite-level + step-level
  source при `zond generate`.
- `src/core/probe/*.ts` — каждый probe-класс выставляет
  `source.generator = "<probe-name>"` на каждом emit-нутом step.
- `src/db/schema.ts` — миграция: ALTER TABLE results ADD COLUMN
  provenance TEXT (JSON-сериализованный source, nullable).
- `src/db/queries.ts` — saveResults сохраняет provenance из step,
  getResultsByRunId возвращает.

## Тесты

- yaml-parser принимает source-блок, отдаёт его в AST.
- yaml-parser принимает yaml БЕЗ source — без warning, без error.
- suite-generator emits source с правильным spec/endpoint/response_branch.
- mass-assignment-probe / negative-probe / schema-validator выставляют
  generator-name.
- DB round-trip: saveResults → getResultsByRunId сохраняет provenance.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 yaml-parser принимает optional suite/step source-блок, отдаёт в AST без warnings
- [x] #2 Manual YAML без source: продолжает работать без изменений (regression-тест)
- [x] #3 zond generate emits suite source + step source с endpoint/response_branch/schema_pointer
- [x] #4 Все probe-классы выставляют source.generator на runtime-emitted steps
- [x] #5 DB-миграция results.provenance + round-trip через saveResults/getResultsByRunId
<!-- AC:END -->
