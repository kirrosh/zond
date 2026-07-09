---
id: ARV-400
title: npm publish v0.27.1 — донести agentic-метаданные до registry
status: To Do
assignee: []
created_date: '2026-07-09 14:45'
labels:
  - m-27
dependencies:
  - ARV-393
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Опубликованный @kirrosh/zond@0.27.0 несёт старое description («API testing platform…») и generic-keywords. Новые метаданные (ARV-393: canonical tagline, задачные keywords; + repository/homepage/bugs) лежат только в git. npm search с дек-2024 = чистый text-match по name/description/readme/keywords — пока не опубликовано, zond ненаходим по целевым запросам. Лаг индексации нового publish — до 2 недель.

См. backlog/docs/agentic-discovery-mcp-report.md §5.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 patch-версия с новыми description/keywords/repository/homepage опубликована в npm
- [ ] #2 npm-страница пакета показывает canonical tagline и линкуется на GitHub
<!-- AC:END -->
