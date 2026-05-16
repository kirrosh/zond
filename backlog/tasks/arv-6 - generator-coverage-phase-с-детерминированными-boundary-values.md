---
id: ARV-6
title: 'generator: coverage phase с детерминированными boundary values'
status: Done
assignee: []
created_date: '2026-05-09 15:47'
updated_date: '2026-05-09 16:58'
labels:
  - generator
  - m-15
  - depth
  - coverage-phase
milestone: m-15
dependencies:
  - ARV-1
priority: high
---

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Snapshot-тест: фиксированная schema из tests/fixtures/coverage-schemas/*.json → стабильное число cases с известным набором меток
- [x] #2 Unit на каждую boundary-функцию: integerBoundaries(schema)→Case[], stringBoundaries, arrayBoundaries, objectBoundaries
- [x] #3 Integration: mock падающий ровно на maxLength+1 → ровно один finding с meta.boundary='maxLength+1'
- [x] #4 Случайность исключена: два запуска coverage phase дают идентичный набор cases (детерминизм)
- [x] #5 Флаг --allow-x00 контролирует включение NUL-байта
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Новый модуль `src/core/generator/coverage-phase.ts` — детерминированный набор Case-ов на каждый параметр/поле. Границы (копируем со schemathesis V4):

- **integer/number**: `min`, `min-1`, `max`, `max+1`, `0`, `-1`, `multipleOf` boundaries; для `exclusive*` — точное значение для проверки rejection.
- **string**: `minLength`, `minLength-1`, `maxLength`, `maxLength+1`, пустая, pattern boundary, format boundary (валидное-на-грани и +1 char для email/url/uuid/date/date-time).
- **array**: `minItems-1/+1`, `maxItems-1/+1`, дубликаты при `uniqueItems`.
- **object**: skip required, лишние props при `additionalProperties:false`, null где не nullable.
- **special chars**: NUL под флагом `--allow-x00` (как у schemathesis), unicode RTL.

Каждый case помечается `meta.phase="coverage"` и `meta.boundary="minLength-1"` — для reproducer и SARIF-finding.

Подключение: `--phase coverage` в `zond checks run` и `zond run`.
<!-- SECTION:PLAN:END -->
