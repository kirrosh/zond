---
id: TASK-180
title: 'repo-hygiene: collapse docs/INDEX.md and docs/project-backlog.md'
status: Done
assignee: []
created_date: '2026-05-07 06:48'
updated_date: '2026-05-07 07:05'
labels:
  - cleanup
  - docs
milestone: m-11
dependencies: []
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
docs/INDEX.md дублирует таблицу из README + ZOND.md. docs/project-backlog.md дублирует AGENTS.md секцию про backlog. Свернуть в один лаконичный docs/README.md (или удалить INDEX и оставить только AGENTS.md секцию).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 docs/INDEX.md удалён или заменён на короткий docs/README.md без дублей
- [x] #2 docs/project-backlog.md свёрнут до stub-ссылки на AGENTS.md или удалён
- [x] #3 Все ссылки в README/AGENTS/skills указывают на актуальные пути
<!-- AC:END -->
