---
id: TASK-54
title: 'T54: Concurrency probe — параллельные POST race'
status: To Do
assignee: []
created_date: '2026-04-27 16:43'
updated_date: '2026-04-29 08:36'
labels:
  - bug-hunting
  - concurrency
milestone: m-4
dependencies: []
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Контекст

Race conditions на write-операциях (одновременное POST одинаковых данных, parallel UPDATE с PUT) — частая причина дубликатов и lost updates. Текущий zond не делает параллельных запросов на один endpoint специально для probe.

## Что сделать

Команда `zond probe-concurrency` или флаг:

Для каждого POST endpoint:
1. Параллельно отправить N (e.g. 10) одинаковых тел без Idempotency-Key.
2. Проверить:
   - Сколько вернули 2xx? (Должны все, если нет уникального constraint.)
   - Создалось N разных ресурсов? (Через follow-up list/get.)
   - Если есть unique constraint в spec — вернулся ли 409 на дубликаты?

Также probe для PUT/PATCH с If-Match (ETag conflict detection):
1. Get resource → ETag A.
2. Two parallel PUT with If-Match: A.
3. Один должен пройти, второй — 412 Precondition Failed.

## Acceptance

- Опциональная команда (медленная, не для CI).
- Output: список endpoints с подозрительным concurrent поведением.
- Документация.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 CLI flag --parallel <N> для probe-concurrency: выстреливает N параллельных копий одной мутации без ручного дублирования YAML-теста
<!-- AC:END -->
