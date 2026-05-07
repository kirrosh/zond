---
id: TASK-179
title: 'repo-hygiene: knip cleanup — unused files, exports, deps'
status: To Do
assignee: []
created_date: '2026-05-07 06:48'
labels:
  - cleanup
  - refactor
milestone: m-11
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
knip --reporter compact даёт: 3 unused files (src/core/diagnostics/render-md.ts, src/core/parser/index.ts, src/core/runner/index.ts), фантомный tailwindcss в dependencies (используется через bun-plugin-tailwind), ~28 unused exports + ~79 unused exported types. Прогнать чистку, оставить только то, что реально импортируется. Options-types для commander можно оставить (используются как сигнатуры). Цель — пустой knip-отчёт по unused files и dependencies.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 bunx knip --reporter compact: 0 unused files
- [ ] #2 0 unused dependencies
- [ ] #3 Cписок unused exports сокращён до подписанного списка исключений (или пуст)
- [ ] #4 bun run check + bun test зелёные
<!-- AC:END -->
