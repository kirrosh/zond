---
id: TASK-2
title: 'T2: Канонизировать source-of-truth для OpenAPI-спеки'
status: Done
assignee: []
created_date: '2026-04-27'
labels:
  - T2
  - phase-0
  - size-S
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
**Зачем.** Сейчас два места: `collections.openapi_spec` (SQLite) и
`.zond-meta.json → specUrl`. SKILL.md явно описывает «если разъехались —
ре-генерируй». Это плохой запах.

**Что.**
1. Канон — БД (`collections.openapi_spec`). `.zond-meta.json` оставить только
   для `specHash` (детектор drift), убрать `specUrl`.
2. Все чтения `specUrl` из `.zond-meta.json` → читать из БД через
   `findCollectionByNameOrId`.
3. Миграция: при старте, если `.zond-meta.json.specUrl` есть, а в БД нет —
   записать в БД, поле из JSON убрать.

**Файлы.** `src/core/meta/meta-store.ts`, `src/core/generator/index.ts`,
`src/core/sync/spec-differ.ts`, упоминания в `skills/api-testing/SKILL.md`
(потом переедут в ресурс).

**Размер.** S.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Тесты `tests/integration/sync.test.ts` зелёные
- [x] #2 В коде нет ни одного чтения `.zond-meta.json.specUrl` после миграции
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Реализовано в коммите `d279866`.

- При исследовании выяснилось, что `specUrl` был **полностью write-only**:
  писался в `generate.ts:95` и `sync.ts:181`, не читался ни в одном модуле.
  Это упростило миграцию.
- Поле удалено из `ZondMeta`, перестало писаться. `JSON.parse(...) as ZondMeta`
  тихо игнорирует лишние поля при чтении старых файлов на диске — явный
  cleanup-скрипт не нужен (forward-compat подтверждён тестом).
- Раздел «Spec reference: two sources of truth» в `skills/api-testing/SKILL.md`
  переписан в «Spec reference» — единственный источник (БД), `specHash`
  остаётся как drift detector.
- Новый `tests/core/meta/meta-store.test.ts`: round-trip, чтение legacy-файла
  с `specUrl`, удаление `specUrl` при перезаписи, детерминизм `hashSpec`.
<!-- SECTION:NOTES:END -->
