---
id: TASK-32
title: 'T32: Auto-discovery ID для positive-smoke через list-эндпоинты'
status: To Do
assignee: []
created_date: '2026-04-27 14:09'
labels:
  - generator
  - robustness
milestone: m-1
dependencies:
  - TASK-27
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Контекст

После T27 positive-smoke сьюты для `GET /resource/{id}` эндпоинтов скипаются на пустом аккаунте через `skip_if`. Чтобы они работали без ручной подстановки ID в `.env.yaml`, можно автоматически получать ID через `GET /resource?limit=1` (если такой эндпоинт есть в OpenAPI).

## Что сделать

1. В `zond generate` для каждого single-resource эндпоинта (`GET /collection/{id}`) проверять, есть ли `GET /collection` в спеке.
2. Если есть — генерировать setup-suite вида:

   ```yaml
   name: Discover {resource} ID
   setup: true
   tests:
     - name: List {resource}s
       GET: /{collection}?limit=1
       expect:
         status: 200
         body:
           data[0].id: { capture: discovered_resource_id }
   ```

3. Positive-smoke использует `{{discovered_resource_id || email_id}}` (с fallback на env).
4. Если list пустой — discovered_resource_id отсутствует → positive-smoke снова скипается (через failedCaptures pipeline).

## Альтернатива: CLI-флаг `--discover-ids`

Не делать setup-сьюты автоматически (могут шуметь), а опционально через `zond run --discover-ids` — runner добавляет дискавери только при флаге.

## Acceptance

- На API с list-эндпоинтами positive-smoke активируется без ручной правки env.
- Если list пустой — graceful skip без ошибок.
- Setup-сьюты не дублируются (один на ресурс).
- Поведение настраивается флагом или конвенцией тегов.

## Зависимости

- T27 (нужны positive-сьюты с тегом needs-id)
<!-- SECTION:DESCRIPTION:END -->
