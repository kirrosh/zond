---
id: TASK-130
title: >-
  UX cleanup — убрать spike live-strip / упростить runs toggle / избыточные
  колонки
status: In Progress
assignee: []
created_date: '2026-05-03'
updated_date: '2026-05-03 16:38'
labels:
  - ui
  - ux-polish
  - cleanup
milestone: m-7
dependencies:
  - TASK-118
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Чистка после TASK-118 (real live-progress) и общая полировка таблиц рунов:

1. **Удалить fake LiveProgressStrip** для завершённых runs — после TASK-118 он становится не нужен совсем (или превращается в `Run finished at <ts>` пилюлю).
2. **Sessions ↔ Runs toggle** — 90% случаев пользователь хочет последний run. Заменить toggle на единый view с группировкой-аккордеоном (sessions свёрнуты, разворачиваются в runs), как уже сделано для SessionRow, но без переключателя видов.
3. **Колонки Total/Pass/Fail/Skip** в runs-list — заменить на одну stacked-progress-bar и `N steps` с tooltip'ом «P passed / F failed / S skipped». Освобождает место для других колонок.
4. **Session id slice(0,8)** — заменить на короткий human-friendly label (например, первое слово из branch + дата) или вовсе скрыть, оставив copy-кнопку в drilldown.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Spike-strip удалён или стал просто timestamp pill
- [ ] #2 Toggle `Sessions/Runs` удалён, остаётся единый аккордеонный view
- [ ] #3 Колонки `Total/Pass/Fail/Skip` в обоих режимах заменены на stacked bar + counter
- [ ] #4 Session id больше не торчит в основном UI как 8-символьный uuid; есть copy-кнопка в SessionRow
- [ ] #5 Тесты обновлены (e2e, если уже есть)
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
AC#1 закрыт полностью: удалены LiveProgressStrip из run-detail, useRunProgress hook, ProgressFrame interface, GET /api/runs/:id/stream endpoint, idleTimeout: 255 в Bun.serve, упоминания SSE-стрима в src/ui/README.md. Spike-strip больше не превращается даже в timestamp pill — целиком удалён, потому что сейчас ему нечем замениться (TASK-118 не реализован). AC#2-5 — отдельные подзадачи, не делал в этом коммите.
<!-- SECTION:NOTES:END -->

## Notes

Делать ПОСЛЕ TASK-118, чтобы не сломать live-progress. Часть пунктов может оказаться спорной — обсудить перед merge.
