---
id: TASK-29
title: 'T29: zond db diagnose — подсказки по env-переменным и недостающим ID'
status: Done
assignee: []
created_date: '2026-04-27 13:42'
updated_date: '2026-05-08 16:37'
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

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
diagnose envelope получил suggested_fixes: (1) placeholder path-params на 404 (example, all-zero UUID, your-…-here, replace-me, sentinel hex), дедупликация по segment'ам; (2) unfilled .env.yaml keys (TODO/<…>/empty/example/your-/replace-me). 11 unit-тестов. 422 schema-mismatch diff пока не реализован — schema_hint уже есть, а полноценный diff требует подключения spec, что overlaps с TASK-145; не блокирует итерацию.
<!-- SECTION:NOTES:END -->
