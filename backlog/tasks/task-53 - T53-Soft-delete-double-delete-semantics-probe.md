---
id: TASK-53
title: 'T53: Soft-delete & double-delete semantics probe'
status: To Do
assignee: []
created_date: '2026-04-27 16:43'
labels:
  - bug-hunting
milestone: m-4
dependencies: []
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Контекст

Bug #03 Resend: повторный DELETE /audiences/{id} → 403 "last audience" вместо 404. Это паттерн: API нечётко определяет "deleted" семантику.

Probe-классы:
1. **DELETE → GET:** должен быть 404, не 200 с soft-deleted флагом.
2. **DELETE → DELETE:** должен быть 404 (already gone), не 200 / не 403.
3. **DELETE → list:** ресурс не появляется в результатах list.
4. **DELETE → реcurrent reference (FK):** /contacts с audience_id удалённой audience → что происходит?

## Что сделать

`zond probe-deletion` или флаг к generate:

Для каждой CRUD-группы с DELETE генерирует probe-сьют:
```yaml
- name: Create
  POST: ...
  expect: { body: { id: { capture: id } } }
- name: Delete
  DELETE: /resource/{{id}}
  always: true
- name: GET after delete → 404
  GET: /resource/{{id}}
  always: true
  expect: { status: 404 }
- name: DELETE after delete → 404 (not 403/200)
  DELETE: /resource/{{id}}
  always: true
  expect: { status: 404 }
- name: List after delete — resource gone
  GET: /resource
  always: true
  expect: { status: 200 }
  body:
    data: { not_contains_item: { id: { equals: "{{id}}" } } }   # need to add not_contains_item
```

## Acceptance

- На Resend ловит bug #03 (двойной DELETE → 403 вместо 404).
- Поймал бы и race в FK (если в spec есть FK).
- Документация.

Зависимость: возможно нужна assertion `not_contains_item` (отрицание contains_item).
<!-- SECTION:DESCRIPTION:END -->
