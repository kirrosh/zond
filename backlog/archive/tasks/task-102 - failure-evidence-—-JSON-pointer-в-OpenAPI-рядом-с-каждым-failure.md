---
id: TASK-102
title: failure-evidence — JSON pointer в OpenAPI рядом с каждым failure
status: Done
assignee: []
created_date: '2026-04-30 09:36'
updated_date: '2026-04-30 10:12'
labels:
  - trust-loop
  - decision-5
  - data
dependencies:
  - TASK-100
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Контекст

UI должен показать backend-у не «у тебя баг в /webhooks», а конкретное
место в спеке («вот response 422 у POST /webhooks, оно говорит вернуть
{error: string}, а вернулся 500»). Без точного pointer-а это руками.

## Что добавляем

Каждое failure в DB и в JSON-envelope получает:

- `spec_pointer`: JSON pointer внутри OpenAPI документа
  (`#/paths/~1webhooks/post/responses/422/content/application~1json/schema`)
- `spec_excerpt`: вырезанный кусок схемы в этом pointer-е (200-500 байт),
  чтобы UI рендерил без необходимости лезть за полным spec файлом.

Зависит от TASK-100 (provenance) — pointer формируется на основе
`source.endpoint` + `source.response_branch` + актуального spec файла.

## Где код

- `src/core/diagnostics/spec-pointer.ts` (новый) — ф-ция
  `buildSpecPointer(source, openApiDoc)` → `{ pointer, excerpt }`.
- Хук в runner или в `db diagnose` (TBD при имплементации) — резолв
  pointer-а по результатам run.
- DB-миграция: results.spec_pointer + results.spec_excerpt (TEXT,
  nullable).

## Что если spec поменялся между run-ом и view-ом

- pointer и excerpt сохраняются в DB на момент run-а — frozen evidence.
- Если spec на диске изменился — UI может показать diff-warning, но это
  отдельная задача.

## Тесты

- buildSpecPointer для openapi-generated suite → правильный pointer.
- buildSpecPointer для probe-step (response_branch=422) → pointer
  на response 422 запрашиваемого endpoint.
- pointer === null если provenance отсутствует (manual YAML).
- DB round-trip.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 buildSpecPointer корректно строит pointer для openapi-generated и probe steps
- [x] #2 spec_excerpt — вырезка из спеки (200-500 байт) на момент run-а
- [x] #3 Manual YAML (без provenance) → spec_pointer/excerpt = null, без error
- [x] #4 DB-миграция results.spec_pointer + spec_excerpt + round-trip
<!-- AC:END -->
