---
id: TASK-127
title: UX — keyboard shortcuts (j/k/?/cmd-k)
status: To Do
assignee: []
created_date: '2026-05-03'
updated_date: '2026-05-08 13:10'
labels:
  - ui
  - ux-polish
milestone: m-7
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Базовые клавиатурные шорткаты для power-user QA: `j/k` — следующий/предыдущий failure в run-detail, `Enter` — раскрыть failure, `Esc` — свернуть; `?` — открыть glossary (TASK-120); `cmd+k` / `ctrl+k` — global command palette (переход на runs/suites/coverage/apis, переход на конкретный run по id).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 `j/k` навигация между FailureCard в run-detail (с auto-scroll)
- [ ] #2 `Enter` раскрывает текущий focused failure, `Esc` сворачивает
- [ ] #3 `?` открывает glossary modal
- [ ] #4 `cmd+k` / `ctrl+k` открывает command palette с навигацией и quick-actions
- [ ] #5 Шорткаты не срабатывают, когда фокус в `<input>` / `<textarea>`
- [ ] #6 Список шорткатов показывается в glossary modal на отдельной вкладке `Keyboard`
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Использовать `cmdk` (shadcn рекомендует) для command palette; обычные шорткаты — на нативных `keydown`-listeners в `useEffect`.
<!-- SECTION:PLAN:END -->
