---
id: TASK-119
title: UX — поиск/фильтр шагов в run-detail
status: To Do
assignee: []
created_date: '2026-05-03'
updated_date: '2026-05-03'
labels:
  - ui
  - ux-polish
milestone: m-7
dependencies: []
priority: high
---

## Description

При >50 шагах в run-detail скроллить список failures больно. Нужен searchbar над списком: substring по `test_name` + быстрые чипы для `method` (GET/POST/...), `response_status` (2xx/4xx/5xx) и `failure_class` (definitely_bug/likely_bug/quirk/cascade).

## Acceptance Criteria

- [ ] Searchbar над списком failures, debounced 200ms
- [ ] Чипы-фильтры: method, status-class, failure-class — multi-select
- [ ] Состояние фильтров живёт в URL search params (shareable)
- [ ] Counter «N of M» обновляется
- [ ] Пустой результат фильтрации — отдельный empty-state с кнопкой clear
- [ ] CascadeGroup тоже фильтруется
