---
id: TASK-35
title: 'T35: Cascade-skip reason inline в console reporter'
status: In Progress
assignee: []
created_date: '2026-04-27 15:28'
updated_date: '2026-04-28 10:22'
labels:
  - reporter
  - ux
milestone: m-1
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Контекст

Когда POST падает 422, последующие шаги корректно скипаются с reason "depends on missing capture: domain_id" (хранится в `StepResult.error`). Но в console-reporter'е выводится только `~ skipped` без причины. Чтобы понять *почему* шаг скипнут, нужно лезть в `zond db diagnose`.

## Что сделать

В `src/core/reporter/console.ts` (или где формируется вывод skipped-шагов) — печатать `error`-поле рядом со status-индикатором:

```
~ Get created domain (skipped: depends on missing capture: domain_id)
~ Update domain (skipped: depends on missing capture: domain_id)
```

То же самое для `skip_if`-скипов: `(skipped: {{user_id}} ==)`.

## Acceptance

- Console-reporter показывает причину skip inline.
- JSON-reporter уже содержит `error` в шаге — без изменений.
- Тест: snapshot console output на сьюте с одним `error` + двумя cascade-skipped шагами.
<!-- SECTION:DESCRIPTION:END -->
