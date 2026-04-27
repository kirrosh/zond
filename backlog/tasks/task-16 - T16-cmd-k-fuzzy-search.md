---
id: TASK-16
title: 'T16: Cmd+K палитра / fuzzy search'
status: To Do
assignee: []
created_date: '2026-04-27'
labels:
  - T16
  - phase-4
  - size-M
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
**Зачем.** Дашборд имеет 4 вкладки и растёт. На больших проектах поиск
становится узким местом.

**Что.**
1. `fuse.js` в dependencies (~10KB gzipped).
2. Один HTML-input в navbar + хоткей `Cmd/Ctrl+K`.
3. Индекс собирается на стороне сервера (endpoints, suites, runs, latest
   failed steps), отдаётся одним JSON. Клиентский Fuse делает фильтрацию.
4. Каждый результат — ссылка на конкретную страницу.

**Файлы.** `src/web/views/layout.ts`, `src/web/views/search.ts` (новый),
`src/web/routes/api.ts` (endpoint `/api/search-index`),
`src/web/static/style.css`.

**Размер.** M.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Cmd+K открывает overlay
- [ ] #2 По запросу из 2+ символов показывает ranked-список
- [ ] #3 Клик — навигация на страницу результата
<!-- AC:END -->
