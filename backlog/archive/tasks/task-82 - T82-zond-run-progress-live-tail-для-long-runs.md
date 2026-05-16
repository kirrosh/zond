---
id: TASK-82
title: 'T82: zond run --progress / live-tail для long runs'
status: To Do
assignee: []
created_date: '2026-04-29 08:41'
labels:
  - runner
  - ux
milestone: m-3
dependencies: []
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Контекст

zond run на 600 пробах молотит 2+ минуты. Из stdout не видно на каком сьюте, сколько осталось. Хочется TTY progress.

`zond serve` (live-tail в браузере) — отдельная фича, тяжёлая. Простой fix — TTY progress в самом run.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 TTY-aware progress bar: Suite N/M, Test N/M, ETA
- [ ] #2 Non-TTY: ничего не меняется
- [ ] #3 Опционально --progress=full с per-test строкой
<!-- AC:END -->
