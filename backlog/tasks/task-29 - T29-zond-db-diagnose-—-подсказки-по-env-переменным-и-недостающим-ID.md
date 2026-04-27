---
id: TASK-29
title: 'T29: zond db diagnose — подсказки по env-переменным и недостающим ID'
status: To Do
assignee: []
created_date: '2026-04-27 13:42'
labels:
  - diagnose
milestone: m-1
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Контекст

`zond db diagnose` уже хорошо кластеризует ошибки. Не хватает actionable-подсказок для двух частых паттернов:

1. **Недостающие ID**: 404 на single-resource, где path-параметр всё ещё `example`. Подсказать, какую переменную из `.env.yaml` подставить.
2. **422 schema mismatch**: показать diff между fixture и schema-format (после T26).
3. **Незаполненные env**: если `.env.yaml` содержит `<TODO>` / `example` / пусто — список таких ключей в выводе diagnose.

## Acceptance

- `zond db diagnose <run-id>` отдельным блоком выводит "Suggested fixes" со ссылками на `.env.yaml` ключи.
- Структурированный JSON через `--format json` (вход в T31).
<!-- SECTION:DESCRIPTION:END -->
