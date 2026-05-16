---
id: TASK-121
title: UX — compare two runs (новый экран)
status: To Do
assignee: []
created_date: '2026-05-03'
updated_date: '2026-05-03'
labels:
  - ui
  - ux-polish
  - regression
milestone: m-7
dependencies:
  - TASK-85
priority: high
---

## Description

UI-эквивалент TASK-85 (`zond db compare`). Экран `/runs/$a/compare/$b` со сравнением двух прогонов: что появилось (new failures), что починилось (fixed), что осталось упавшим (still failing), что изменило status code / response shape. Точка входа — кнопка «Compare with…» в run-detail (выпадашка с последними N runs того же session/suite).

## Acceptance Criteria

- [ ] Маршрут `/runs/$a/compare/$b`
- [ ] Группы: New failures / Fixed / Still failing / Status changed / Body changed
- [ ] Каждая группа сворачивается, шаги в ней — те же FailureCard, что и в run-detail
- [ ] Body diff — side-by-side, через `diff`-библиотеку (jsdiff)
- [ ] Из run-detail кнопка «Compare with…» с последними 5 runs того же suite/session
- [ ] Запрос `/api/runs/$a/compare/$b` возвращает уже посчитанный diff (не сырые данные)
