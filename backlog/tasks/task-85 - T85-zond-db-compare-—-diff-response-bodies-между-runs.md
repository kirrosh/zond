---
id: TASK-85
title: 'T85: zond db compare — diff response bodies между runs'
status: To Do
assignee: []
created_date: '2026-04-29 08:41'
labels:
  - regression
  - bug-hunting
milestone: m-4
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Контекст

Текущий `zond db compare A B` — два списка по тестам (PASS/FAIL diff). Но реальная регрессионная ценность — diff response bodies на одних и тех же тестах. Это контракт-дрифт-детектор без OpenAPI: 'вчера /emails возвращал поле regions: [...], сегодня поле пропало'.

## Что сделать

В compare:
1. Match по test-name между runs.
2. Структурный diff response.body (deep diff).
3. Group findings: 'field removed' / 'type changed' / 'value diff' / 'status diff'.
4. Markdown / JSON output.

Полезно как regression detector в CI — staging vs prod, день N vs день N-1.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 compare A B показывает diff полей в response bodies на одинаковых тестах
- [ ] #2 Findings: 'in run B test X /emails больше не возвращает поле regions' (contract-drift detection без OpenAPI)
- [ ] #3 Опция --bodies-only / --status-only для шумо-фильтра
- [ ] #4 Документация
<!-- AC:END -->
