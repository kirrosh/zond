---
id: TASK-127
title: UX — keyboard shortcuts (j/k/?/cmd-k)
status: To Do
assignee: []
created_date: '2026-05-03'
updated_date: '2026-05-03'
labels:
  - ui
  - ux-polish
milestone: m-7
dependencies:
  - TASK-120
priority: medium
---

## Description

Базовые клавиатурные шорткаты для power-user QA: `j/k` — следующий/предыдущий failure в run-detail, `Enter` — раскрыть failure, `Esc` — свернуть; `?` — открыть glossary (TASK-120); `cmd+k` / `ctrl+k` — global command palette (переход на runs/suites/coverage/apis, переход на конкретный run по id).

## Acceptance Criteria

- [ ] `j/k` навигация между FailureCard в run-detail (с auto-scroll)
- [ ] `Enter` раскрывает текущий focused failure, `Esc` сворачивает
- [ ] `?` открывает glossary modal
- [ ] `cmd+k` / `ctrl+k` открывает command palette с навигацией и quick-actions
- [ ] Шорткаты не срабатывают, когда фокус в `<input>` / `<textarea>`
- [ ] Список шорткатов показывается в glossary modal на отдельной вкладке `Keyboard`

## Implementation Plan

Использовать `cmdk` (shadcn рекомендует) для command palette; обычные шорткаты — на нативных `keydown`-listeners в `useEffect`.
