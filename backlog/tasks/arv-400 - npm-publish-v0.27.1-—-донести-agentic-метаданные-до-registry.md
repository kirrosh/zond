---
id: ARV-400
title: npm publish v0.27.1 — донести agentic-метаданные до registry
status: Done
assignee: []
created_date: '2026-07-09 14:45'
updated_date: '2026-07-09 15:35'
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
- [x] #1 patch-версия с новыми description/keywords/repository/homepage опубликована в npm
- [x] #2 npm-страница пакета показывает canonical tagline и линкуется на GitHub
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Всё готово к релизу: v0.27.1 забамплен (package.json + plugin.json + CHANGELOG), смержен в master и запушен (bc27a96), dev синхронизирован. Остался ОДИН шаг — push тега, который триггерит release.yml (5 бинарей + gh release + npm publish). Авто-режим дважды заблокировал (публикация в публичный npm) — выполнить руками:
  git push origin v0.27.1  # тег уже создан локально
или через `! git -c credential.helper='!gh auth git-credential' push https://github.com/kirrosh/zond.git v0.27.1`

Выпущено 2026-07-09: тег v0.27.1 → release.yml зелёный (run 29029948203), 5 таргетов + checksums в gh release, npm publish прошёл. npm view подтверждает: version 0.27.1, canonical tagline, 14 задачных keywords, homepage→GitHub. Полная переиндексация npm search — до 2 недель.
<!-- SECTION:NOTES:END -->
