---
id: TASK-79
title: 'T79: probe-сьюты должны эмитить cleanup-секцию'
status: Done
assignee: []
created_date: '2026-04-29 08:40'
updated_date: '2026-04-29 09:30'
labels:
  - bug-hunting
  - generator
  - safety
milestone: m-4
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Контекст

Round 2: probe-validation реально создал 4 топика в проде Resend, потому что мутации шли на POST /topics. zond не помечает 'эти ресурсы создали наши пробы — вот их id'. Чистил руками.

CRUD-сьюты уже имеют always: true для DELETE-шага (TASK-44). Probe-сьюты сгенерены без cleanup — inconsistency между двумя классами генерации.

## Что сделать

В probe-генераторах (validation/methods/etc):
1. Если probe — POST/PUT/PATCH успешно создал ресурс, эмитировать follow-up DELETE step с always: true.
2. Если DELETE для path не описан в spec — логировать 'leaked resource: <id>' в run-результат.
3. Опция --no-cleanup для случаев когда тестируется namespace-isolated env (staging dump-and-reset).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 probe-validation для POST/PUT/PATCH эмитит DELETE-step с always: true
- [x] #2 Если ресурс не имеет DELETE — лог 'created during run #X: <ids>'
- [x] #3 Опция --no-cleanup для опт-аут поведения
- [x] #4 Тест: probe-validation на CRUD-эндпоинте — после run количество ресурсов в API == до run
<!-- AC:END -->
