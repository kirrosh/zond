---
id: TASK-129
title: UX — mobile/responsive layout для основных экранов
status: To Do
assignee: []
created_date: '2026-05-03'
updated_date: '2026-05-03'
labels:
  - ui
  - ux-polish
  - responsive
milestone: m-7
dependencies: []
priority: low
---

## Description

Все экраны зашиты в `max-w-5xl` / `max-w-7xl` (coverage), таблицы не адаптируются под узкие viewports. Use case — посмотреть failed run с телефона, когда CI прислал ссылку. Не нужен полноценный mobile-first, нужен sane fallback.

## Acceptance Criteria

- [ ] runs-list: на <md колонки `Pass/Fail/Skip` сворачиваются в одну `Results`
- [ ] run-detail: header переходит в одну колонку на <sm; FailureCard остаётся читаемым
- [ ] coverage: таблица скроллит горизонтально с sticky-первой-колонкой; drilldown — modal-bottom-sheet вместо sidebar
- [ ] suites: file-колонка скрывается на <md
- [ ] Навигация в header переезжает в hamburger при <sm
- [ ] Проверено в Playwright e2e на viewport 375×812 и 1440×900
