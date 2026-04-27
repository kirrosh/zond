---
id: TASK-28
title: 'T28: Тег [ephemeral] vs [persistent-write] для CRUD-сьютов'
status: To Do
assignee: []
created_date: '2026-04-27 13:42'
labels:
  - generator
  - tags
milestone: m-1
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Контекст

Текущая конвенция `[smoke] / [crud] / [unsafe]` не различает:
- **ephemeral**: create→use→delete внутри одного suite (после прогона состояние API не меняется).
- **persistent-write**: create без cleanup (оставляет хвосты в API).

Для CI важно по дефолту запускать только ephemeral writes; persistent-writes требуют явного opt-in.

## Что сделать

- Добавить теги `[ephemeral]` и `[persistent-write]`.
- В `zond generate` помечать сьюты с финальным `delete` шагом → `[ephemeral]`, остальные write-сьюты → `[persistent-write]`.
- `zond run --tag ephemeral` / `--tag '!persistent-write'` для фильтрации.
- Обновить CI-шаблоны (`zond ci generate`) на дефолт `--tag '!persistent-write'`.

## Acceptance

- Теги проставляются генератором автоматически.
- Документировано в ZOND.md и в Definition of Done для тестов.
<!-- SECTION:DESCRIPTION:END -->
