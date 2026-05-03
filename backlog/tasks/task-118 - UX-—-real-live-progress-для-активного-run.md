---
id: TASK-118
title: UX — real live-progress для активного run (заменить spike)
status: To Do
assignee: []
created_date: '2026-05-03'
updated_date: '2026-05-03'
labels:
  - ui
  - ux-polish
  - sse
milestone: m-7
dependencies: []
priority: high
---

## Description

В `run-detail.tsx` `LiveProgressStrip` сейчас — спайк: сервер отдаёт fake ramp-up для любого run, чтобы SSE-провод был наблюдаем. Комментарий в коде честно говорит: «Production would auto-start only for runs with finished_at === null». Нужно довести до прод-поведения.

## Acceptance Criteria

- [ ] SSE-стрим автоматически открывается ТОЛЬКО если `run.finished_at === null` (активный run)
- [ ] Для завершённого run панель не показывается вовсе (или сворачивается в `Run finished at <ts>`)
- [ ] Ребро прогресса (текущий step name + method + path) видно во время выполнения, не только counter
- [ ] При завершении run UI делает `invalidateQuery` на `runDetailQueryOptions(runId)` — failures появляются без перезагрузки
- [ ] Серверный fake ramp-up удалён из `src/ui/server/server.ts` (если он там, — проверить)

## Implementation Plan

1. Поправить `useRunProgress` чтобы стрим не открывался для завершённых runs
2. На сервере: эмитить реальные progress-события из runner'а (если уже эмитятся — проверить формат `{ completed, total, current_test }`)
3. В UI добавить отображение текущего шага
4. По `done`-event — invalidate кэш TanStack Query
