---
id: TASK-118
title: UX — real live-progress для активного run (заменить spike)
status: To Do
assignee: []
created_date: '2026-05-03'
updated_date: '2026-05-03 16:38'
labels:
  - ui
  - ux-polish
  - sse
milestone: m-7
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
В `run-detail.tsx` `LiveProgressStrip` сейчас — спайк: сервер отдаёт fake ramp-up для любого run, чтобы SSE-провод был наблюдаем. Комментарий в коде честно говорит: «Production would auto-start only for runs with finished_at === null». Нужно довести до прод-поведения.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 SSE-стрим автоматически открывается ТОЛЬКО если `run.finished_at === null` (активный run)
- [ ] #2 Для завершённого run панель не показывается вовсе (или сворачивается в `Run finished at <ts>`)
- [ ] #3 Ребро прогресса (текущий step name + method + path) видно во время выполнения, не только counter
- [ ] #4 При завершении run UI делает `invalidateQuery` на `runDetailQueryOptions(runId)` — failures появляются без перезагрузки
- [ ] #5 Серверный fake ramp-up удалён из `src/ui/server/server.ts` (если он там, — проверить)
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Поправить `useRunProgress` чтобы стрим не открывался для завершённых runs
2. На сервере: эмитить реальные progress-события из runner'а (если уже эмитятся — проверить формат `{ completed, total, current_test }`)
3. В UI добавить отображение текущего шага
4. По `done`-event — invalidate кэш TanStack Query
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Removal-часть AC ('Серверный fake ramp-up удалён') выполнена в TASK-130: удалён GET /api/runs/:id/stream и весь UI-провод (useRunProgress hook, LiveProgressStrip, ProgressFrame). После этого TASK-118 перестаёт быть про 'довести spike до прода' и становится про 'сделать SSE с нуля поверх runner-а'. Возвращаю в To Do до момента, когда runner начнёт эмитить progress-события.
<!-- SECTION:NOTES:END -->
